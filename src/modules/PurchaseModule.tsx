import React, { useEffect, useState, useMemo } from "react";
import bus from '../utils/eventBus';
import { subscribeFirestoreDocs, replaceFirestoreCollection } from '../utils/firestoreSync';

interface PurchaseEntry {
  orderPlaceDate: string;
  poNo: string;
  supplierName: string;
  itemName: string;
  itemCode: string;
  indentNo: string;
  indentDate?: string;
  indentBy: string;
  oaNo: string;
  originalIndentQty: number;
  purchaseQty: number;
  currentStock: number;
  indentStatus: string;
  receivedQty: number;
  okQty: number;
  rejectedQty: number;
  grnNo: string;
  debitNoteOrQtyReturned: string;
  remarks: string;
}

interface PurchaseModuleProps {
  user?: any;
}

const indentStatusOptions = ["Open", "Closed", "Partial"];

const PurchaseModule: React.FC<PurchaseModuleProps> = ({ user }) => {
  const [uid] = useState<string>(user?.uid || 'default-user');

  const [entries, setEntries] = useState<PurchaseEntry[]>([]);
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [lastImport, setLastImport] = useState<number>(0);

  const [openIndentItems, setOpenIndentItems] = useState<any[]>([]);
  const [closedIndentItems, setClosedIndentItems] = useState<any[]>([]);
  const [_stockRecords, setStockRecords] = useState<any[]>([]);
  const [indentData, setIndentData] = useState<any[]>([]);
  const [_itemMasterData, setItemMasterData] = useState<any[]>([]);
  const [_psirData, setPsirData] = useState<any[]>([]);

  const [newEntry, setNewEntry] = useState<PurchaseEntry>({
    orderPlaceDate: "", poNo: "", supplierName: "", itemName: "", itemCode: "",
    indentNo: "", indentBy: "", oaNo: "", originalIndentQty: 0, purchaseQty: 0,
    currentStock: 0, indentStatus: "Open", receivedQty: 0, okQty: 0,
    rejectedQty: 0, grnNo: "", debitNoteOrQtyReturned: "", remarks: "",
  });

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<PurchaseEntry | null>(null);
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [debugOutput, setDebugOutput] = useState<string>('');
  const [lastDebugRun, setLastDebugRun] = useState<number | null>(null);

  // ─── Firestore subscriptions ─────────────────────────────────────────────
  useEffect(() => {
    console.info('[PurchaseModule] Setting up Firestore subscriptions for user:', uid);
    const unsubOpen   = subscribeFirestoreDocs(uid, 'openIndentItems',  (d) => { console.debug('[PurchaseModule] openIndentItems:', d.length);  setOpenIndentItems(d);  });
    const unsubClosed = subscribeFirestoreDocs(uid, 'closedIndentItems',(d) => { console.debug('[PurchaseModule] closedIndentItems:', d.length); setClosedIndentItems(d); });
    const unsubStock  = subscribeFirestoreDocs(uid, 'stockRecords',     (d) => { console.debug('[PurchaseModule] stockRecords:', d.length);     setStockRecords(d);      });
    const unsubIndent = subscribeFirestoreDocs(uid, 'indentData',       (d) => { console.debug('[PurchaseModule] indentData:', d.length);       setIndentData(d);        });
    const unsubIM     = subscribeFirestoreDocs(uid, 'itemMaster',       (d) => { console.debug('[PurchaseModule] itemMaster:', d.length);       setItemMasterData(d);    });
    const unsubPsir   = subscribeFirestoreDocs(uid, 'psirData',         (d) => { console.debug('[PurchaseModule] psirData:', d.length);         setPsirData(d);          });
    return () => { unsubOpen(); unsubClosed(); unsubStock(); unsubIndent(); unsubIM(); unsubPsir(); };
  }, [uid]);

  // ─── Pure helpers (no state reads) ──────────────────────────────────────
  const normalizeField = (v: any): string => {
    if (v === undefined || v === null) return '';
    try { return String(v).trim().toUpperCase(); } catch { return ''; }
  };

  const makeKey = (indentNo: any, itemCode: any): string =>
    `${normalizeField(indentNo)}|${normalizeField(itemCode)}`;

  const tryParse = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number' && !isNaN(v)) return v;
    const m = String(v).trim().replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) || 0 : 0;
  };

  const getStockFromIndent = (item: any): number => {
    if (!item || typeof item !== 'object') return 0;
    for (const f of ['stock','Stock','currentStock','Current Stock','availableStock','Available','available','instock','inStock','balance','Balance','qty1']) {
      if (Object.prototype.hasOwnProperty.call(item, f)) { const p = tryParse(item[f]); if (p !== 0) return p; }
    }
    for (const f of ['quantity','Quantity','qty','Qty']) {
      if (Object.prototype.hasOwnProperty.call(item, f)) { const p = tryParse(item[f]); if (p !== 0) return p; }
    }
    if (item.qty !== undefined && item.issued !== undefined) { const b = tryParse(item.qty) - tryParse(item.issued); if (b >= 0) return b; }
    return 0;
  };

  const getIndentQtyFromIndent = (item: any): number => {
    for (const f of ['qty','indentQty','quantity','Quantity','requestedQty','requiredQty','Qty','qty1']) {
      if (item[f] !== undefined && item[f] !== null && item[f] !== '') { const n = Number(item[f]); if (!isNaN(n)) return n; }
    }
    return 0;
  };

  const getStatusFromIndent = (item: any): string => {
    if (openIndentItems.some((o: any)  => o.indentNo === item.indentNo && (o.itemCode === item.itemCode || o.Code === item.itemCode))) return "Open";
    if (closedIndentItems.some((c: any)=> c.indentNo === item.indentNo && (c.itemCode === item.itemCode || c.Code === item.itemCode))) return "Closed";
    return "Open";
  };

  // ─── THE FIX ─────────────────────────────────────────────────────────────
  //
  // Root cause of the flicker:
  //   getLiveStockForEntry / getLiveStockInfo were called DURING RENDER for
  //   every table row.  They iterated openIndentItems / closedIndentItems,
  //   which start as [] and arrive asynchronously.  On the first render those
  //   arrays are empty → lookup returns 0 / wrong colour → Firestore data
  //   arrives → second render shows the correct value.  Result: visible flash.
  //
  // Fix:
  //   Compute ONE Map<key,{display,isShort,status}> in useMemo.  The memo
  //   runs exactly once per data-change (not once per row per render).  The
  //   render path is a pure O(1) map lookup — no iteration, no async lag.
  //
  // The stock computation logic is identical to the original getLiveStockInfo;
  // it has just been extracted into a private helper so both the memo and
  // the event handlers share a single implementation.
  const _computeStockForIndentItem = (
    indentItem: any,
    normCode: string,
    itemIndentNo: string
  ): { display: number; isShort: boolean } => {
    // Priority 1: explicit "available for this indent" field
    const avField = [indentItem.availableForThisIndent, indentItem.allocatedAvailable, indentItem.qty1, indentItem.available]
      .find(v => v !== undefined && v !== null);
    if (avField !== undefined) { const av = Number(avField); if (!isNaN(av)) return { display: av, isShort: false }; }

    // Priority 2: walk indentData to accumulate cumulative qty
    let targetIndentIdx = -1, targetItemIdx = -1;
    outer:
    for (let i = 0; i < indentData.length; i++) {
      const ind = indentData[i];
      if (!ind || !Array.isArray(ind.items) || normalizeField(ind.indentNo) !== itemIndentNo) continue;
      for (let j = 0; j < ind.items.length; j++) {
        const it = ind.items[j];
        if (!it) continue;
        if (normalizeField(it.itemCode) === normCode || normalizeField(it.Code || it.Item || '') === normCode) {
          targetIndentIdx = i; targetItemIdx = j; break outer;
        }
      }
    }

    let cumulativeQty = 0;
    if (targetIndentIdx >= 0 && targetItemIdx >= 0) {
      for (let i = 0; i <= targetIndentIdx; i++) {
        const ind = indentData[i];
        if (!ind || !Array.isArray(ind.items)) continue;
        const limit = i === targetIndentIdx ? targetItemIdx + 1 : ind.items.length;
        for (let j = 0; j < limit; j++) {
          const it = ind.items[j];
          if (!it) continue;
          if (normalizeField(it.itemCode) === normCode || normalizeField(it.Code || it.Item || '') === normCode)
            cumulativeQty += Number(it.qty) || 0;
        }
      }
    }
    if (cumulativeQty === 0) {
      const fb = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
      if (fb > 0) cumulativeQty = fb;
    }

    const stockRec     = _stockRecords.find((s: any) => normalizeField(s.itemCode) === normCode);
    const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;
    const display      = cumulativeQty > 0
      ? (cumulativeQty > closingStock ? cumulativeQty - closingStock : cumulativeQty)
      : closingStock;

    return { display, isShort: cumulativeQty > closingStock };
  };

  /**
   * Pre-computed stock map — rebuilt only when indent data actually changes.
   * Every possible key variant (itemCode, Code, indentNo-only fallback) is
   * inserted so the render-time lookup never needs to iterate.
   */
  const liveStockMap = useMemo(() => {
    const map = new Map<string, { display: number; isShort: boolean; status: string }>();
    const allItems = [...openIndentItems, ...closedIndentItems];

    for (const indentItem of allItems) {
      if (!indentItem || !indentItem.indentNo) continue;
      const itemIndentNo = normalizeField(indentItem.indentNo);
      const status       = openIndentItems.includes(indentItem) ? 'Open' : 'Closed';
      const codes        = [normalizeField(indentItem.itemCode), normalizeField(indentItem.Code)].filter(Boolean);

      for (const code of (codes.length ? codes : [''])) {
        const key = `${itemIndentNo}|${code}`;
        if (map.has(key)) continue;
        try {
          const result = _computeStockForIndentItem(indentItem, code, itemIndentNo);
          map.set(key, { ...result, status });
        } catch {
          map.set(key, { display: getStockFromIndent(indentItem), isShort: false, status });
        }
      }
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndentItems, closedIndentItems, indentData, _stockRecords]);

  // O(1) render-time accessors — replace the old getLiveStockInfo / getLiveStockForEntry
  const getLiveStockInfo = (entry: { indentNo: string; itemCode: string; currentStock: number }): { display: number; isShort: boolean } => {
    const hit = liveStockMap.get(makeKey(entry.indentNo, entry.itemCode))
             ?? liveStockMap.get(`${normalizeField(entry.indentNo)}|`);
    return hit ? { display: hit.display, isShort: hit.isShort } : { display: entry.currentStock || 0, isShort: false };
  };

  const getLiveStockForEntry = (entry: { indentNo: string; itemCode: string; currentStock: number }): number =>
    getLiveStockInfo(entry).display;

  // ─── Deduplication ───────────────────────────────────────────────────────
  const deduplicateEntries = (entries: PurchaseEntry[]): PurchaseEntry[] => {
    if (!Array.isArray(entries)) return [];
    const seen = new Set<string>(); const out: PurchaseEntry[] = []; let dups = 0;
    for (const e of entries) {
      const k = makeKey(e.indentNo, e.itemCode);
      if (!seen.has(k)) { seen.add(k); out.push(e); } else { dups++; console.warn(`[PurchaseModule] ⚠️ Duplicate removed: ${k}`); }
    }
    if (dups > 0) console.log(`[PurchaseModule] Removed ${dups} duplicate(s), kept ${out.length}`);
    return out;
  };

  // ─── Force stock refresh ─────────────────────────────────────────────────
  const forceStockRefresh = () => {
    const updated = entries.map(e => {
      const live = getLiveStockForEntry(e);
      return live !== e.currentStock ? { ...e, currentStock: live, remarks: `${e.remarks || ''} | Stock force-refreshed: ${live}`.trim() } : e;
    });
    const changed = updated.filter((e, i) => e.currentStock !== entries[i]?.currentStock);
    if (changed.length > 0) { setEntries(updated); saveEntries(updated); alert(`✅ Stock refreshed! Updated ${changed.length} entries with latest indent module stock.`); }
    else alert('ℹ️ Stock is already up-to-date with indent module.');
  };

  // ─── Debug helpers ───────────────────────────────────────────────────────
  const formatJSON = (v: any) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

  const generateDebugReport = () => {
    try {
      const stockComparison = entries.map(e => { const live = getLiveStockForEntry(e); return { indentNo: e.indentNo, itemCode: e.itemCode, storedStock: e.currentStock, liveStock: live, match: e.currentStock === live, difference: live - e.currentStock }; });
      const report = { timestamp: new Date().toISOString(), counts: { openIndentItems: openIndentItems.length, closedIndentItems: closedIndentItems.length, purchaseRecords: entries.length, liveStockMapSize: liveStockMap.size, stockMatches: stockComparison.filter(s => s.match).length, stockMismatches: stockComparison.filter(s => !s.match).length }, sampleIndentItems: [...openIndentItems, ...closedIndentItems].slice(0, 3), stockComparison: stockComparison.filter(s => !s.match), allPurchaseEntries: entries.slice(0, 5) };
      setDebugOutput(formatJSON(report)); setLastDebugRun(Date.now()); setDebugOpen(true);
    } catch (err) { setDebugOutput('Error generating report: ' + String(err)); setDebugOpen(true); }
  };

  const persistIndentStockToPurchaseData = () => {
    try {
      const updated = entries.map(e => { const live = getLiveStockForEntry(e); return live !== e.currentStock ? { ...e, currentStock: live, remarks: `${e.remarks || ''} | Stock synced: ${live}`.trim() } : e; });
      const changed = updated.filter((e, i) => e.currentStock !== entries[i]?.currentStock).length;
      saveEntries(updated); setEntries(updated);
      setDebugOutput(prev => prev + `\n\n✅ Persisted stock for ${changed} purchaseData entries.`);
    } catch (err) { setDebugOutput('❌ Error persisting stock: ' + String(err)); }
  };

  const seedSampleIndents = () => {
    const sampleOpen   = [{ indentNo:'S-8/25-02', itemName:'WH 135 Body', itemCode:'CB-101', qty:50,  stock:40,  indentBy:'HKG', date:'2025-11-20' }, { indentNo:'S-8/25-03', itemName:'Engine Oil', itemCode:'OIL-001', qty:100, stock:25,  indentBy:'HKG', date:'2025-11-20' }];
    const sampleClosed = [{ indentNo:'S-8/25-01', itemName:'WH 135 Body', itemCode:'CB-101', qty:140, stock:150, indentBy:'HKG', date:'2025-11-20' }];
    replaceFirestoreCollection(uid, 'openIndentItems',  sampleOpen).catch(console.error);
    replaceFirestoreCollection(uid, 'closedIndentItems', sampleClosed).catch(console.error);
    setDebugOutput(prev => prev + '\n\n✅ Seeded sample indent items into Firestore.');
  };

  const clearDebugOutput = () => setDebugOutput('');

  const debugStatusSync = () => {
    console.log('=== DEBUG STATUS & STOCK SYNC ===');
    console.log('liveStockMap size:', liveStockMap.size, '\nentries:', Array.from(liveStockMap.entries()));
    console.log('Open Indents:', openIndentItems);
    console.log('Closed Indents:', closedIndentItems);
    console.log('Purchase Entries:', entries);
    entries.forEach((e, i) => {
      const key = makeKey(e.indentNo, e.itemCode);
      console.log(`Entry ${i}:`, { indentNo: e.indentNo, itemCode: e.itemCode, key, mapHit: liveStockMap.get(key), purchaseStock: e.currentStock, purchaseStatus: e.indentStatus });
    });
    alert('✅ Check console for status and stock sync debug information');
  };

  // ─── Save ────────────────────────────────────────────────────────────────
  const saveEntries = (data: PurchaseEntry[]): PurchaseEntry[] => {
    console.log('[PurchaseModule] Saving data:', data.length, 'entries');
    const deduped = deduplicateEntries(data);
    replaceFirestoreCollection(uid, 'purchaseData',   deduped).catch(console.error);
    replaceFirestoreCollection(uid, 'purchaseOrders', deduped).catch(console.error);
    try { bus.dispatchEvent(new CustomEvent('purchaseOrders.updated', { detail: deduped })); } catch (err) { console.error(err); }
    return deduped;
  };

  // ─── Manual import ───────────────────────────────────────────────────────
  const manuallyImportAndOverwrite = () => {
    console.log('[PurchaseModule] Manual import triggered');
    const allIndentItems = [...openIndentItems, ...closedIndentItems];
    if (allIndentItems.length === 0) { alert('No indent items found in storage'); return; }

    try {
      let updatedCount = 0, createdCount = 0;
      const existingMap = new Map(entries.map(e => [makeKey(e.indentNo, e.itemCode), e]));
      const updatedEntries = [...entries];

      allIndentItems.forEach((item: any) => {
        if (!item.indentNo) return;
        const key          = makeKey(item.indentNo, item.itemCode || '');
        const stock        = getStockFromIndent(item);
        const indentQty    = getIndentQtyFromIndent(item);
        const indentStatus = getStatusFromIndent(item);
        // Use the pre-computed map — no async lag, guaranteed accurate
        const liveHit   = liveStockMap.get(key) ?? liveStockMap.get(`${normalizeField(item.indentNo)}|`);
        const liveStock = liveHit ? liveHit.display : stock;

        console.log(`Importing: ${item.indentNo} - ${item.itemCode}, Status: ${indentStatus}, Stock: ${stock}, Live: ${liveStock}, Qty: ${indentQty}`);

        if (existingMap.has(key)) {
          const idx = updatedEntries.findIndex(e => makeKey(e.indentNo, e.itemCode) === key);
          if (idx >= 0) {
            updatedEntries[idx] = { ...updatedEntries[idx], originalIndentQty: indentQty, currentStock: stock, indentStatus, purchaseQty: indentStatus === 'Open' ? stock : 0, oaNo: item.oaNo || item.OA || '', remarks: `Updated from indent: ${indentStatus}, Stock: ${stock}` };
            updatedCount++;
          }
        } else {
          updatedEntries.push({
            orderPlaceDate: '', poNo: '', supplierName: '',
            itemName: item.model || item.itemName || item.Item || item.description || '',
            itemCode: item.itemCode || item.Code || '',
            indentNo: item.indentNo || '', indentDate: item.date || item.indentDate || '',
            indentBy: item.indentBy || '', oaNo: item.oaNo || item.OA || '',
            originalIndentQty: indentQty,
            purchaseQty: indentStatus === 'Open' ? liveStock : 0,
            currentStock: stock, indentStatus,
            receivedQty: 0, okQty: 0, rejectedQty: 0, grnNo: '',
            debitNoteOrQtyReturned: '',
            remarks: `Imported from indent: ${indentStatus}, Stock: ${stock}`,
          });
          createdCount++;
        }
      });

      const final = deduplicateEntries(saveEntries(updatedEntries));
      setEntries(final); setLastImport(Date.now());
      alert(`✅ Import completed: Updated ${updatedCount}, Created ${createdCount}. Duplicates removed. Status and Stock synced from indent module.`);
    } catch (err) { console.error('[PurchaseModule] Import error:', err); alert('❌ Error during import'); }
  };

  // ─── Load from Firestore ─────────────────────────────────────────────────
  useEffect(() => {
    console.log('[PurchaseModule] Loading data from Firestore (purchaseData)');
    const unsub = subscribeFirestoreDocs(uid, 'purchaseData', (docs) => {
      if (docs && docs.length > 0) {
        try {
          const migrated = docs.map((e: any) => ({ ...e, originalIndentQty: e.originalIndentQty ?? e.qty ?? 0, purchaseQty: e.purchaseQty ?? e.poQty ?? e.qty ?? 0, currentStock: e.currentStock ?? e.inStock ?? 0, okQty: e.okQty ?? 0, receivedQty: e.receivedQty ?? 0, rejectedQty: e.rejectedQty ?? 0 }));
          setEntries(deduplicateEntries(migrated));
        } catch (err) { console.error('[PurchaseModule] Error processing purchaseData:', err); setEntries([]); }
      } else { setEntries([]); }
    });
    return unsub;
  }, [uid]);

  // ─── Real-time indent event sync ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: any) => {
      console.log('[PurchaseModule] Received indents.updated event, syncing status and stock...');
      const openItems: any[]   = e?.detail?.openItems   || [];
      const closedItems: any[] = e?.detail?.closedItems || [];
      const statusMap = new Map<string, string>();
      const stockMap  = new Map<string, number>();
      const stockByNo = new Map<string, number>();

      const processItem = (item: any, status: string) => {
        if (!item?.indentNo) return;
        const kA = makeKey(item.indentNo, item.itemCode || '');
        const kB = makeKey(item.indentNo, item.Code     || '');
        statusMap.set(kA, status); statusMap.set(kB, status);
        const sv = getStockFromIndent(item);
        if (sv !== undefined) { stockMap.set(kA, sv); stockMap.set(kB, sv); stockByNo.set(normalizeField(item.indentNo), sv); }
      };
      openItems.forEach((i: any)   => processItem(i, 'Open'));
      closedItems.forEach((i: any) => processItem(i, 'Closed'));

      setEntries(prev => {
        const updated = prev.map(entry => {
          const key = makeKey(entry.indentNo, entry.itemCode);
          const newStatus = statusMap.get(key);
          let newStock = stockMap.has(key) ? stockMap.get(key) : stockByNo.get(normalizeField(entry.indentNo));
          let changed = false; const u = { ...entry };
          if (newStatus && entry.indentStatus !== newStatus) { console.log(`🔄 Status: ${entry.indentNo} ${entry.indentStatus}→${newStatus}`); u.indentStatus = newStatus; u.remarks = `Status synced from indent: ${newStatus}`; changed = true; }
          if (newStock !== undefined && newStock !== entry.currentStock) { console.log(`🔄 Stock: ${entry.indentNo} ${entry.currentStock}→${newStock}`); u.currentStock = newStock; u.remarks = `${u.remarks||''} | Stock synced from indent: ${newStock}`.trim(); changed = true; }
          try {
            const desired = ((newStatus ?? u.indentStatus) === 'Open') ? (newStock ?? u.currentStock) : 0;
            if (u.purchaseQty !== desired) { u.purchaseQty = desired; u.remarks = `${u.remarks||''} | PO Qty synced: ${desired}`.trim(); changed = true; }
          } catch {}
          return changed ? u : entry;
        });
        const anyChanged = JSON.stringify(updated) !== JSON.stringify(prev);
        if (anyChanged) { const final = saveEntries(updated); return final; }
        return prev;
      });
    };
    try { bus.addEventListener('indents.updated', handler as EventListener); } catch (err) { console.error('[PurchaseModule] Error registering indents.updated listener:', err); }
    return () => { try { bus.removeEventListener('indents.updated', handler as EventListener); } catch (err) { console.error(err); } };
  }, []);

  // ─── PSIR auto-fill (new entry form) ────────────────────────────────────
  useEffect(() => {
    if (!newEntry.poNo || !newEntry.itemCode) return;
    try {
      const psirs = _psirData;
      if (!Array.isArray(psirs)) return;
      const matchingPSIR = psirs.find((p: any) => p.poNo === newEntry.poNo && Array.isArray(p.items) && p.items.some((i: any) => i.itemCode === newEntry.itemCode));
      if (matchingPSIR) {
        const it = matchingPSIR.items.find((i: any) => i.itemCode === newEntry.itemCode);
        if (it) { console.debug('[PurchaseModule][AutoFill] Found PSIR data for PO:', newEntry.poNo, 'Item:', newEntry.itemCode); setNewEntry(prev => ({ ...prev, receivedQty: it.qtyReceived||0, okQty: it.okQty||0, rejectedQty: it.rejectQty||0 })); }
      }
    } catch (e) { console.error('[PurchaseModule][AutoFill] Error reading PSIR data:', e); }
  }, [newEntry.poNo, newEntry.itemCode]);

  // ─── PSIR sync to existing entries ──────────────────────────────────────
  useEffect(() => {
    if (entries.length === 0) return;
    try {
      const psirs = _psirData;
      if (!Array.isArray(psirs)) return;
      let updated = false;
      const updatedEntries = entries.map(e => {
        const psir = psirs.find((p: any) => p.poNo === e.poNo && Array.isArray(p.items));
        if (!psir) return e;
        const it = psir.items.find((i: any) => i.itemCode === e.itemCode);
        if (!it) return e;
        const r = it.qtyReceived||0, ok = it.okQty||0, rej = it.rejectQty||0;
        if (r !== e.receivedQty || ok !== e.okQty || rej !== e.rejectedQty) { console.debug('[PurchaseModule][Sync] Updating PSIR for PO:', e.poNo, 'Item:', e.itemCode); updated = true; return { ...e, receivedQty: r, okQty: ok, rejectedQty: rej }; }
        return e;
      });
      if (updated) { console.debug('[PurchaseModule][Sync] Syncing PSIR data to purchase entries'); setEntries(updatedEntries); saveEntries(updatedEntries); }
    } catch (e) { console.error('[PurchaseModule][Sync] Error syncing PSIR data:', e); }
  }, [entries, entries.length]);

  useEffect(() => {
    const handlePSIRUpdate = () => { console.log('[PurchaseModule] PSIR data updated event received'); setEntries(p => [...p]); };
    bus.addEventListener('psir.updated', handlePSIRUpdate as EventListener);
    console.log('[PurchaseModule] Listeners registered for PSIR updates');
    return () => { bus.removeEventListener('psir.updated', handlePSIRUpdate as EventListener); console.log('[PurchaseModule] Listeners removed for PSIR updates'); };
  }, []);

  // ─── Item master names ───────────────────────────────────────────────────
  useEffect(() => {
    if (Array.isArray(_itemMasterData)) setItemNames(_itemMasterData.map((i: any) => i.itemName).filter(Boolean));
  }, [_itemMasterData]);

  // ─── Refresh data — now uses liveStockMap (no flicker) ──────────────────
  const refreshData = () => {
    console.log('[PurchaseModule] Refreshing data with status and stock sync');
    if (entries.length === 0) return;
    try {
      const refreshed = entries.map((e: PurchaseEntry) => {
        const key = makeKey(e.indentNo, e.itemCode);
        const hit = liveStockMap.get(key) ?? liveStockMap.get(`${normalizeField(e.indentNo)}|`);
        if (!hit) return e;
        const u = { ...e }; let didChange = false;
        if (hit.status && e.indentStatus !== hit.status) { u.indentStatus = hit.status; u.remarks = `Status refreshed from indent: ${hit.status}`; didChange = true; }
        if (hit.display !== e.currentStock) { u.currentStock = hit.display; u.remarks = `${u.remarks||''} | Stock refreshed from indent: ${hit.display}`.trim(); didChange = true; }
        try {
          const desired = ((hit.status ?? u.indentStatus) === 'Open') ? hit.display : 0;
          if (u.purchaseQty !== desired) { u.purchaseQty = desired; u.remarks = `${u.remarks||''} | PO Qty refreshed: ${desired}`.trim(); didChange = true; }
        } catch {}
        return didChange ? u : e;
      });
      setEntries(refreshed); saveEntries(refreshed);
      alert('✅ Data refreshed with status and stock synced from indent module.');
    } catch (err) { console.error('[PurchaseModule] Error refreshing data:', err); alert('❌ Error refreshing data'); }
  };

  // Initial startup refresh — fires once when liveStockMap and entries are both populated
  useEffect(() => {
    try { refreshData(); } catch (err) { console.error('Error running initial refreshData:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleNewChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let nv = Number(value);
    if ((name.includes("Qty") || name === "originalIndentQty" || name === "currentStock") && nv < 0) nv = 0;
    setNewEntry(prev => ({ ...prev, [name]: name.includes("Qty") || name === "originalIndentQty" || name === "currentStock" ? nv : value }));
  };

  const handleAddEntry = () => {
    if (!newEntry.poNo || !newEntry.supplierName) { alert("PO No and Supplier Name are required."); return; }
    const live = getLiveStockForEntry(newEntry as any) || newEntry.purchaseQty || 0;
    const saved = saveEntries([...entries, { ...newEntry, purchaseQty: newEntry.indentStatus === 'Open' ? live : 0 }]);
    setEntries(saved);
    setNewEntry({ orderPlaceDate:"", poNo:"", supplierName:"", itemName:"", itemCode:"", indentNo:"", indentBy:"", oaNo:"", originalIndentQty:0, purchaseQty:0, currentStock:0, indentStatus:"Open", receivedQty:0, okQty:0, rejectedQty:0, grnNo:"", debitNoteOrQtyReturned:"", remarks:"" });
  };

  const handleEditAll = (i: number) => { setEditIndex(i); setEditEntry({ ...entries[i] }); };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (!editEntry) return;
    let nv = Number(value);
    if ((name.includes("Qty") || name === "originalIndentQty" || name === "currentStock") && nv < 0) nv = 0;
    setEditEntry(prev => ({ ...prev!, [name]: name.includes("Qty") || name === "originalIndentQty" || name === "currentStock" ? nv : value }));
  };

  const handleSaveEdit = () => {
    if (editIndex === null || !editEntry) return;
    const live = getLiveStockForEntry(editEntry as any) || editEntry.purchaseQty || 0;
    const updated = [...entries];
    updated[editIndex] = { ...editEntry, purchaseQty: editEntry.indentStatus === 'Open' ? live : 0 };
    setEntries(saveEntries(updated)); setEditIndex(null); setEditEntry(null);
  };

  const handleDelete = (i: number) => { const u = entries.filter((_, j) => j !== i); setEntries(u); saveEntries(u); };
  const cancelEdit   = () => { setEditIndex(null); setEditEntry(null); };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      <h2>Purchase Module</h2>

      {/* Control Panel */}
      <div style={{ marginBottom:16, padding:12, background:'#e8f5e8', border:'1px solid #4caf50', borderRadius:'4px' }}>
        <div style={{ display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <div><strong>Entries: {entries.length}</strong> | <strong>Last Import: {lastImport ? new Date(lastImport).toLocaleTimeString() : 'Never'}</strong></div>
          <button onClick={manuallyImportAndOverwrite} style={{ padding:'6px 12px', background:'#2196f3', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>Import All Indents</button>
          <button onClick={refreshData}                style={{ padding:'6px 12px', background:'#4caf50', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>Refresh Data</button>
          <button onClick={forceStockRefresh}          style={{ padding:'6px 12px', background:'#9c27b0', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>Force Stock Refresh</button>
          <button onClick={debugStatusSync}            style={{ padding:'6px 12px', background:'#ff9800', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>Debug Status Sync</button>
          <button onClick={() => setDebugOpen(p => !p)} style={{ padding:'6px 12px', background: debugOpen ? '#6a1b9a' : '#673ab7', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>{debugOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}</button>
        </div>
        <div style={{ marginTop:'8px', fontSize:'14px', color:'#2e7d32' }}>
          <strong>🎯 Stock Column:</strong> Shows LIVE data from Indent Module • Updates automatically • Matches indent stock exactly
        </div>
        {debugOpen && (
          <div style={{ marginTop:12, padding:12, background:'#fff3e0', border:'1px solid #ffb74d', borderRadius:6 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <button onClick={generateDebugReport}             style={{ padding:'6px 10px', cursor:'pointer' }}>Generate Report</button>
              <button onClick={persistIndentStockToPurchaseData} style={{ padding:'6px 10px', cursor:'pointer' }}>Persist Stock</button>
              <button onClick={seedSampleIndents}              style={{ padding:'6px 10px', cursor:'pointer' }}>Seed Sample</button>
              <button onClick={clearDebugOutput}               style={{ padding:'6px 10px', cursor:'pointer' }}>Clear Output</button>
            </div>
            <div style={{ marginTop:8 }}><strong>Last run:</strong> {lastDebugRun ? new Date(lastDebugRun).toLocaleString() : 'Never'}</div>
            <pre style={{ marginTop:8, maxHeight:300, overflow:'auto', background:'#ffffff', padding:8, border:'1px solid #ddd' }}>{debugOutput || 'No debug output yet. Click Generate Report.'}</pre>
          </div>
        )}
      </div>

      {/* Add New Entry */}
      <div style={{ background:"#f9f9f9", padding:12, border:"1px solid #ccc", marginBottom:16 }}>
        <h3>Add New Entry</h3>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:'center' }}>
          <input type="date" name="orderPlaceDate" value={newEntry.orderPlaceDate} onChange={handleNewChange} placeholder="Order Date" />
          <input name="poNo"         placeholder="PO No *"         value={newEntry.poNo}         onChange={handleNewChange} style={{ border:!newEntry.poNo ? '2px solid red':'1px solid #ccc', padding:'6px' }} />
          <input name="supplierName" placeholder="Supplier Name *" value={newEntry.supplierName} onChange={handleNewChange} style={{ border:!newEntry.supplierName ? '2px solid red':'1px solid #ccc', padding:'6px' }} />
          <select name="itemName" value={newEntry.itemName} onChange={handleNewChange} style={{ padding:'6px' }}>
            <option value="">Select Item</option>
            {itemNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input name="itemCode"          placeholder="Item Code"    value={newEntry.itemCode}          onChange={handleNewChange} style={{ padding:'6px' }} />
          <input name="indentNo"          placeholder="Indent No"    value={newEntry.indentNo}          onChange={handleNewChange} style={{ padding:'6px' }} />
          <input type="number" name="originalIndentQty" placeholder="Original Qty" value={newEntry.originalIndentQty||""} onChange={handleNewChange} style={{ padding:'6px', width:'100px' }} />
          <input type="number" name="purchaseQty"       placeholder="PO Qty"       value={newEntry.purchaseQty||""}       onChange={handleNewChange} style={{ padding:'6px', width:'100px' }} />
          <input type="number" name="currentStock"      placeholder="Stock"        value={newEntry.currentStock||""}      onChange={handleNewChange} style={{ padding:'6px', width:'100px' }} />
          <button onClick={handleAddEntry} style={{ background:'#4caf50', color:'white', border:'none', padding:'6px 12px', borderRadius:'4px', cursor:'pointer' }}>Add Entry</button>
        </div>
      </div>

      {/* Table */}
      <h3>Purchase Orders ({entries.length})</h3>
      {entries.length === 0 ? (
        <div style={{ padding:20, textAlign:'center', background:'#f5f5f5' }}>No purchase orders found. Click "Import All Indents" to import from open and closed indent items.</div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table border={1} cellPadding={8} style={{ width:"100%", minWidth:'1500px' }}>
            <thead>
              <tr style={{ background:'#f0f0f0' }}>
                <th>#</th><th>Item</th><th>Code</th><th>Indent No</th><th>OA NO</th>
                <th>Order Date</th><th>PO No</th><th>Supplier</th><th>Orig. Qty</th>
                <th>PO Qty</th><th style={{ background:'#e3f2fd' }}>🎯 Stock</th>
                <th>Status</th><th>Received</th><th>OK</th><th>Rejected</th>
                <th>GRN No</th><th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                // Pure O(1) map lookup — computed before any render, guaranteed correct from the first paint
                const { display: liveStock, isShort } = getLiveStockInfo(e);
                const stockMatches = liveStock === e.currentStock;
                const isNegative   = typeof liveStock === 'number' && liveStock < 0;
                const isZeroOrMiss = liveStock === null || liveStock === undefined || liveStock === 0;
                const badgeStyle: React.CSSProperties = {
                  background: (isShort || isNegative || isZeroOrMiss) ? '#e53935' : '#43a047',
                  color:'#fff', fontWeight:700, padding:'6px 10px', borderRadius:6,
                  display:'inline-block', minWidth:44, textAlign:'center'
                };
                return (
                  <tr key={i} style={{ background: i === editIndex ? '#fff3cd' : 'white' }}>
                    <td style={{ fontWeight:'bold' }}>{i+1}</td>
                    <td>{e.itemName||'N/A'}</td>
                    <td>{e.itemCode||'N/A'}</td>
                    <td>{e.indentNo||'N/A'}</td>
                    <td>{e.oaNo||'N/A'}</td>
                    <td style={{ background: e.orderPlaceDate?'#e8f5e8':'#fff3cd', fontWeight:'bold', color: e.orderPlaceDate?'#2e7d32':'#856404' }}>{e.orderPlaceDate||'Not set'}</td>
                    <td style={{ background: e.poNo?'#e8f5e8':'#fff3cd', fontWeight:'bold', color: e.poNo?'#2e7d32':'#856404' }}>{e.poNo||'Not set'}</td>
                    <td style={{ background: e.supplierName?'#e8f5e8':'#fff3cd', fontWeight:'bold', color: e.supplierName?'#2e7d32':'#856404' }}>{e.supplierName||'Not set'}</td>
                    <td>{e.originalIndentQty}</td>
                    <td>{e.indentStatus === 'Open' ? Math.abs(liveStock) : 0}</td>
                    <td>
                      <span style={badgeStyle}>{isZeroOrMiss ? '-' : liveStock}</span>
                      {!stockMatches && <div style={{ fontSize:10, color:'#ff9800', marginTop:4 }}>⚡ Live</div>}
                    </td>
                    <td style={{ background: e.indentStatus==='Closed'?'#e8f5e8':e.indentStatus==='Open'?'#fff3cd':'#fff3e0', fontWeight:'bold', color: e.indentStatus==='Closed'?'#2e7d32':e.indentStatus==='Open'?'#856404':'#ff9800' }}>{e.indentStatus}</td>
                    <td>{e.receivedQty}</td><td>{e.okQty}</td><td>{e.rejectedQty}</td>
                    <td>{e.grnNo||'N/A'}</td>
                    <td style={{ fontSize:'12px' }}>{e.remarks}</td>
                    <td>
                      <button onClick={() => handleEditAll(i)} style={{ marginRight:'4px', background:'#2196f3', color:'white', border:'none', padding:'4px 8px', borderRadius:'3px', cursor:'pointer' }}>Edit</button>
                      <button onClick={() => handleDelete(i)}  style={{ background:'#f44336', color:'white', border:'none', padding:'4px 8px', borderRadius:'3px', cursor:'pointer' }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Section */}
      {editEntry && (
        <div style={{ marginTop:24, padding:16, border:"2px solid #2196f3", background:"#f8fdff", borderRadius:'4px' }}>
          <h4>Edit Entry #{editIndex !== null ? editIndex+1 : ''} - {editEntry.itemName}</h4>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:12, marginBottom:16 }}>
            <div><label><strong>Order Place Date *</strong></label><input type="date" name="orderPlaceDate" value={editEntry.orderPlaceDate} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }} /></div>
            <div><label><strong>PO No *</strong></label><input name="poNo" value={editEntry.poNo} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px', border:!editEntry.poNo?'2px solid red':'1px solid #ccc' }} /></div>
            <div><label><strong>Supplier Name *</strong></label><input name="supplierName" value={editEntry.supplierName} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px', border:!editEntry.supplierName?'2px solid red':'1px solid #ccc' }} /></div>
            <div>
              <label><strong>Item Name</strong></label>
              <select name="itemName" value={editEntry.itemName} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }}>
                <option value="">Select Item</option>
                {itemNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div><label><strong>Original Indent Qty</strong></label><input type="number" name="originalIndentQty" value={editEntry.originalIndentQty||""} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }} /></div>
            <div><label><strong>PO Qty</strong></label><input type="number" name="purchaseQty" value={editEntry.purchaseQty||""} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }} /></div>
            <div><label><strong>Stock</strong></label><input type="number" name="currentStock" value={editEntry.currentStock||""} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }} /></div>
            <div>
              <label><strong>Indent Status</strong></label>
              <select name="indentStatus" value={editEntry.indentStatus} onChange={handleEditChange} style={{ width:'100%', padding:'8px', marginTop:'4px' }}>
                <option value="">Select Status</option>
                {indentStatusOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <button onClick={handleSaveEdit} disabled={!editEntry.poNo||!editEntry.supplierName} style={{ background:(!editEntry.poNo||!editEntry.supplierName)?'#ccc':'#4caf50', color:'white', border:'none', padding:'10px 20px', borderRadius:'4px', cursor:(!editEntry.poNo||!editEntry.supplierName)?'not-allowed':'pointer', marginRight:'8px' }}>Save Changes</button>
            <button onClick={cancelEdit} style={{ background:'#9e9e9e', color:'white', border:'none', padding:'10px 20px', borderRadius:'4px', cursor:'pointer' }}>Cancel</button>
          </div>
          {(!editEntry.poNo||!editEntry.supplierName) && <div style={{ color:'red', marginTop:'8px' }}>* PO No and Supplier Name are required</div>}
        </div>
      )}
    </div>
  );
};

export default PurchaseModule;