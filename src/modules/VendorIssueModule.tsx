import React, { useState, useEffect } from 'react';
import bus from '../utils/eventBus';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  subscribeVendorIssues,
  addVendorIssue,
  updateVendorIssue,
  deleteVendorIssue,
  subscribeVendorDepts,
  getItemMaster,
  subscribeVSIRRecords,
  subscribePurchaseOrders,
} from '../utils/firestoreServices';
import { subscribePsirs } from '../utils/psirService'; // *** FIX: import PSIR subscription ***

interface VendorIssueItem {
  itemName: string;
  itemCode: string;
  qty: number;
  indentBy: string;
  inStock: number;
  indentClosed: boolean;
}

interface VendorIssue {
  id?: string;
  date: string;
  materialPurchasePoNo: string;
  oaNo: string;
  batchNo: string;
  vendorBatchNo: string;
  dcNo: string;
  issueNo: string;
  vendorName: string;
  items: VendorIssueItem[];
}

const indentByOptions = ['HKG', 'NGR', 'MDD'];

function getNextIssueNo(issues: VendorIssue[]) {
  const base = 'ISS-';
  if (issues.length === 0) return base + '01';
  const lastSerial = Math.max(
    ...issues.map(i => {
      const match = i.issueNo.match(/ISS-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  return base + String(lastSerial + 1).padStart(2, '0');
}

function getNextDCNo(issues: VendorIssue[]) {
  const prefix = 'Vendor/';
  const nums = issues.map(issue => {
    const match = issue.dcNo && issue.dcNo.startsWith(prefix) ? parseInt(issue.dcNo.replace(prefix, '')) : 0;
    return isNaN(match) ? 0 : match;
  });
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}${String(maxNum + 1).padStart(2, '0')}`;
}

const VendorIssueModule: React.FC = () => {
  const [issues, setIssues] = useState<VendorIssue[]>(() => {
    const saved = localStorage.getItem('vendorIssueData');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return parsed.map((issue: any) => ({
        ...issue,
        vendorName: issue.vendorName || '',
        vendorBatchNo: issue.vendorBatchNo || '',
        items: Array.isArray(issue.items) ? issue.items : [],
      }));
    } catch { return []; }
  });

  // *** FIX: track PSIR data from Firestore subscription ***
  const [psirData, setPsirData] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      if (uid) {
        (async () => {
          try {
            const raw = localStorage.getItem('vendorIssueData');
            if (raw) {
              const arr = JSON.parse(raw || '[]');
              if (Array.isArray(arr) && arr.length > 0) {
                for (const it of arr as VendorIssue[]) {
                  try {
                    const payload = { ...it } as any;
                    if (typeof payload.id !== 'undefined') delete payload.id;
                    const col = collection(db, 'userData', uid, 'vendorIssueData');
                    await addDoc(col, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                  } catch (err) {
                    console.warn('[VendorIssueModule] migration addDoc failed for item', it, err);
                  }
                }
                try { localStorage.removeItem('vendorIssueData'); } catch {}
              }
            }
          } catch (err) { console.error('[VendorIssueModule] Migration failed:', err); }
        })();
      }
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const [newIssue, setNewIssue] = useState<VendorIssue>({
    date: '', materialPurchasePoNo: '', oaNo: '', batchNo: '', vendorBatchNo: '',
    dcNo: '', issueNo: getNextIssueNo([]), vendorName: '', items: [],
  });

  const [itemInput, setItemInput] = useState<VendorIssueItem>({
    itemName: '', itemCode: '', qty: 0, indentBy: '', inStock: 0, indentClosed: false,
  });

  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [vsirRecords, setVsirRecords] = useState<any[]>([]);
  const [editIssueIdx, setEditIssueIdx] = useState<number | null>(null);

  const deduplicateVendorIssues = (arr: VendorIssue[]): VendorIssue[] => {
    const seen = new Set<string>();
    const deduped: VendorIssue[] = [];
    for (const issue of arr) {
      const firstItemKey = issue.items && issue.items.length > 0 ? `${issue.items[0].itemCode || issue.items[0].itemName}` : '';
      const key = `${String(issue.materialPurchasePoNo || '').trim().toLowerCase()}|${issue.date}|${firstItemKey}`;
      if (key && !seen.has(key)) { seen.add(key); deduped.push(issue); }
    }
    return deduped;
  };

  const getVendorBatchNoFromVSIR = (poNo: any): string => {
    try {
      if (!poNo) return '';
      const poNoNormalized = String(poNo).trim();
      const match = vsirRecords.find((r: any) => String(r.poNo || '').trim() === poNoNormalized && r.vendorBatchNo && String(r.vendorBatchNo).trim());
      return match ? match.vendorBatchNo : '';
    } catch { return ''; }
  };

  // *** FIX: helper to look up batchNo from PSIR data (Firestore-subscribed) ***
  const getBatchNoFromPSIR = (poNo: string): string => {
    try {
      if (!poNo) return '';
      const match = psirData.find((p: any) => String(p.poNo || '').trim() === String(poNo).trim());
      return match ? (match.batchNo || '') : '';
    } catch { return ''; }
  };

  const getOaNoFromPSIR = (poNo: string): string => {
    try {
      if (!poNo) return '';
      const match = psirData.find((p: any) => String(p.poNo || '').trim() === String(poNo).trim());
      return match ? (match.oaNo || '') : '';
    } catch { return ''; }
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => setUserUid(u ? u.uid : null));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    let unsubIssues: (() => void) | null = null;
    let unsubVendorDepts: (() => void) | null = null;
    let unsubVsir: (() => void) | null = null;
    let unsubPurchaseOrders: (() => void) | null = null;
    let unsubPsirs: (() => void) | null = null; // *** FIX ***

    if (!userUid) return () => {};

    try { unsubIssues = subscribeVendorIssues(userUid, (docs) => { const mapped = docs.map(d => ({ ...d, items: Array.isArray(d.items) ? d.items : [] })); setIssues(deduplicateVendorIssues(mapped as VendorIssue[])); }); } catch (err) { console.error('[VendorIssueModule] subscribeVendorIssues failed:', err); }
    try { unsubVendorDepts = subscribeVendorDepts(userUid, (docs) => setVendorDeptOrders(docs)); } catch (err) { console.error('[VendorIssueModule] subscribeVendorDepts failed:', err); }
    try { unsubVsir = subscribeVSIRRecords(userUid, (docs) => setVsirRecords(docs)); } catch (err) { console.error('[VendorIssueModule] subscribeVSIRRecords failed:', err); }
    try { unsubPurchaseOrders = subscribePurchaseOrders(userUid, (docs) => setPurchaseOrders(docs || [])); } catch (err) { console.error('[VendorIssueModule] subscribePurchaseOrders failed:', err); }

    // *** FIX: subscribe to PSIR from Firestore so batchNo is always available ***
    try {
      unsubPsirs = subscribePsirs(userUid, (docs) => {
        console.log('[VendorIssueModule] PSIR subscription updated:', docs.length, 'records');
        setPsirData(docs || []);
      });
    } catch (err) { console.error('[VendorIssueModule] subscribePsirs failed:', err); }

    (async () => {
      try {
        const im = await getItemMaster(userUid);
        if (Array.isArray(im) && im.length > 0) { setItemMaster(im as any); setItemNames(im.map((it: any) => it.itemName).filter(Boolean)); }
      } catch (err) { console.error('[VendorIssueModule] getItemMaster failed:', err); }
    })();

    return () => {
      if (unsubIssues) unsubIssues();
      if (unsubVendorDepts) unsubVendorDepts();
      if (unsubVsir) unsubVsir();
      if (unsubPurchaseOrders) unsubPurchaseOrders();
      if (unsubPsirs) unsubPsirs(); // *** FIX ***
    };
  }, [userUid]);

  useEffect(() => {
    const itemMasterRaw = localStorage.getItem('itemMasterData');
    if (itemMasterRaw) { try { const parsed = JSON.parse(itemMasterRaw); if (Array.isArray(parsed)) { setItemMaster(parsed); setItemNames(parsed.map((item: any) => item.itemName).filter(Boolean)); } } catch {} }
    const vendorDeptRaw = localStorage.getItem('vendorDeptData');
    if (vendorDeptRaw) { try { setVendorDeptOrders(JSON.parse(vendorDeptRaw)); } catch {} }
  }, []);

  useEffect(() => {
    const handleVendorDeptUpdate = () => {
      const vendorDeptRaw = localStorage.getItem('vendorDeptData');
      if (vendorDeptRaw) { try { setVendorDeptOrders(JSON.parse(vendorDeptRaw)); } catch {} }
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'vendorDeptData') handleVendorDeptUpdate();
    };
    window.addEventListener('storage', storageHandler);
    bus.addEventListener('vendorDept.updated', handleVendorDeptUpdate as EventListener);
    bus.addEventListener('vsir.updated', (() => {}) as EventListener);
    return () => {
      window.removeEventListener('storage', storageHandler);
      bus.removeEventListener('vendorDept.updated', handleVendorDeptUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (newIssue.materialPurchasePoNo) return;
    if (vendorDeptOrders.length > 0) {
      const latest = vendorDeptOrders[vendorDeptOrders.length - 1];
      if (latest && latest.materialPurchasePoNo) setNewIssue(prev => ({ ...prev, materialPurchasePoNo: latest.materialPurchasePoNo }));
    }
  }, [vendorDeptOrders, newIssue.materialPurchasePoNo]);

  useEffect(() => {
    if (!newIssue.materialPurchasePoNo || newIssue.items.length > 0) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    if (!match || !Array.isArray(match.items) || match.items.length === 0) return;
    const items = match.items.map((item: any) => ({
      itemName: item.itemName || '', itemCode: item.itemCode || '',
      qty: typeof item.plannedQty === 'number' ? item.plannedQty : (item.qty || 0),
      indentBy: item.indentBy || '', inStock: 0, indentClosed: false,
    }));
    const today = new Date().toISOString().slice(0, 10);
    setNewIssue(prev => ({ ...prev, items, date: prev.date || today }));
  }, [newIssue.materialPurchasePoNo, vendorDeptOrders, newIssue.items.length]);

  // Auto-fill OA No, Batch No, Vendor Name, DC No, Vendor Batch No when PO changes
  useEffect(() => {
    if (!newIssue.materialPurchasePoNo) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);

    let oaNoValue = match?.oaNo || '';
    let batchNoValue = match?.batchNo || '';
    let vendorBatchNoValue = match?.vendorBatchNo || '';
    let vendorNameValue = match?.vendorName || '';
    let dcNoValue = (match?.dcNo && String(match.dcNo).trim() !== '') ? String(match.dcNo) : '';

    // *** FIX: fill batchNo and oaNo from live PSIR subscription if still missing ***
    if (!batchNoValue) batchNoValue = getBatchNoFromPSIR(newIssue.materialPurchasePoNo);
    if (!oaNoValue) oaNoValue = getOaNoFromPSIR(newIssue.materialPurchasePoNo);

    // Fallback PSIR from localStorage (legacy)
    if (!oaNoValue || !batchNoValue) {
      try {
        const psirRaw = localStorage.getItem('psirData');
        if (psirRaw) {
          const psirs = JSON.parse(psirRaw);
          if (Array.isArray(psirs)) {
            const psirMatch = psirs.find((p: any) => p.poNo === newIssue.materialPurchasePoNo);
            if (psirMatch) { if (!oaNoValue) oaNoValue = psirMatch.oaNo || ''; if (!batchNoValue) batchNoValue = psirMatch.batchNo || ''; }
          }
        }
      } catch {}
    }

    if (!vendorBatchNoValue) vendorBatchNoValue = getVendorBatchNoFromVSIR(newIssue.materialPurchasePoNo);

    setNewIssue(prev => ({
      ...prev,
      oaNo: oaNoValue || prev.oaNo,
      batchNo: batchNoValue || prev.batchNo,
      vendorBatchNo: vendorBatchNoValue || prev.vendorBatchNo,
      vendorName: vendorNameValue || prev.vendorName,
      dcNo: dcNoValue || prev.dcNo,
    }));
  }, [newIssue.materialPurchasePoNo, vendorDeptOrders, psirData]); // *** FIX: depend on psirData ***

  // *** FIX: sync batchNo/oaNo from live psirData into existing issues ***
  useEffect(() => {
    if (issues.length === 0 || (vendorDeptOrders.length === 0 && psirData.length === 0)) return;

    let updated = false;
    const updatedIssues = issues.map(issue => {
      const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === issue.materialPurchasePoNo);
      let newVendorName = issue.vendorName;
      let newVendorBatchNo = issue.vendorBatchNo;
      let newBatchNo = issue.batchNo;
      let newOaNo = issue.oaNo;
      let needsUpdate = false;

      if (!newVendorName && match?.vendorName) { newVendorName = match.vendorName; needsUpdate = true; }
      if (!newVendorBatchNo && match?.vendorBatchNo) { newVendorBatchNo = match.vendorBatchNo; needsUpdate = true; }

      // *** FIX: fill batchNo from live psirData if still empty ***
      if (!newBatchNo && issue.materialPurchasePoNo) {
        const psirBatch = getBatchNoFromPSIR(issue.materialPurchasePoNo);
        if (psirBatch) { newBatchNo = psirBatch; needsUpdate = true; }
      }
      if (!newOaNo && issue.materialPurchasePoNo) {
        const psirOa = getOaNoFromPSIR(issue.materialPurchasePoNo);
        if (psirOa) { newOaNo = psirOa; needsUpdate = true; }
      }
      // Also fill from vendorDeptOrders
      if (!newBatchNo && match?.batchNo) { newBatchNo = match.batchNo; needsUpdate = true; }
      if (!newOaNo && match?.oaNo) { newOaNo = match.oaNo; needsUpdate = true; }

      if (!newVendorBatchNo) {
        const vsirVB = getVendorBatchNoFromVSIR(issue.materialPurchasePoNo);
        if (vsirVB) { newVendorBatchNo = vsirVB; needsUpdate = true; }
      }

      // *** FIX: patch items where qty=0 — try vendorDeptOrders.plannedQty first, then purchaseOrders ***
      const newItems = issue.items.map(item => {
        if (item.qty > 0) return item;
        let resolvedQty = 0;
        // 1. vendorDeptOrders plannedQty
        if (match && Array.isArray(match.items)) {
          const deptItem = match.items.find((di: any) =>
            (di.itemCode && item.itemCode && String(di.itemCode).trim() === String(item.itemCode).trim()) ||
            (di.itemName && String(di.itemName).trim() === String(item.itemName).trim())
          );
          if (deptItem) resolvedQty = (typeof deptItem.plannedQty === 'number' && deptItem.plannedQty > 0) ? deptItem.plannedQty : Number(deptItem.qty) || 0;
        }
        // 2. purchaseOrders entry
        if (!resolvedQty) {
          const poEntry = purchaseOrders.find((po: any) =>
            String(po.poNo || '').trim() === String(issue.materialPurchasePoNo || '').trim() &&
            (String(po.itemCode || '').trim() === String(item.itemCode || '').trim() ||
             String(po.itemName || po.model || '').trim() === String(item.itemName || '').trim())
          );
          if (poEntry) resolvedQty = Number(poEntry.plannedQty) || Number(poEntry.purchaseQty) || Number(poEntry.originalIndentQty) || Number(poEntry.poQty) || Number(poEntry.qty) || 0;
        }
        if (resolvedQty > 0) { needsUpdate = true; return { ...item, qty: resolvedQty }; }
        return item;
      });

      if (needsUpdate) {
        updated = true;
        return { ...issue, vendorName: newVendorName, vendorBatchNo: newVendorBatchNo, batchNo: newBatchNo, oaNo: newOaNo, items: newItems };
      }
      return issue;
    });

    if (updated) {
      const deduped = deduplicateVendorIssues(updatedIssues);
      setIssues(deduped);
      if (userUid) {
        (async () => {
          try {
            await Promise.all(deduped.map(async (iss: any) => {
              if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
              else await addVendorIssue(userUid, iss);
            }));
          } catch (err) {
            console.error('[VendorIssueModule] Failed to persist synced info to Firestore:', err);
            try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {}
          }
        })();
      }
    }
  }, [vendorDeptOrders, psirData, vsirRecords, purchaseOrders]); // also depends on purchaseOrders for qty backfill

  useEffect(() => {
    if (
      newIssue.materialPurchasePoNo && newIssue.date && newIssue.items.length > 0 &&
      !issues.some(issue => issue.materialPurchasePoNo === newIssue.materialPurchasePoNo)
    ) {
      const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
      const autoDcNo = (match && match.dcNo && String(match.dcNo).trim() !== '') ? String(match.dcNo) : getNextDCNo(issues);
      const updated = [...issues, { ...newIssue, dcNo: autoDcNo, issueNo: getNextIssueNo(issues) }];
      const deduped = deduplicateVendorIssues(updated);
      setIssues(deduped);
      if (userUid) {
        (async () => {
          try { const last = deduped[deduped.length - 1]; if (last && !last.id) await addVendorIssue(userUid, last); }
          catch (err) { console.error('[VendorIssueModule] Failed to add Vendor Issue to Firestore:', err); try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
        })();
      } else { try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
      clearNewIssue(deduped);
    }
  }, [newIssue, issues, vendorDeptOrders]);

  useEffect(() => {
    // *** FIX: wait for vendorDeptOrders to be loaded before importing, so plannedQty is available ***
    if (purchaseOrders.length === 0 || !userUid) return;

    const poGroups: Record<string, any[]> = {};
    purchaseOrders.forEach((entry: any) => {
      if (!entry.poNo) return;
      if (!poGroups[entry.poNo]) poGroups[entry.poNo] = [];
      poGroups[entry.poNo].push(entry);
    });

    const currentIssues = issues || [];
    const existingPOs = new Set(currentIssues.map(issue => issue.materialPurchasePoNo));
    let added = false;
    const newIssues = [...currentIssues];

    Object.keys(poGroups).forEach(poNo => {
      if (!existingPOs.has(poNo)) {
        const group = poGroups[poNo];
        // *** FIX: resolve qty from multiple field names, cross-ref vendorDeptOrders plannedQty ***
        const deptMatchForQty = vendorDeptOrders.find(order => order.materialPurchasePoNo === poNo);
        const items = group.map((item: any) => {
          let resolvedQty = 0;
          // 1. Check vendorDeptOrders.items[].plannedQty (most authoritative)
          if (deptMatchForQty && Array.isArray(deptMatchForQty.items)) {
            const deptItem = deptMatchForQty.items.find((di: any) =>
              (di.itemCode && item.itemCode && String(di.itemCode).trim() === String(item.itemCode).trim()) ||
              (di.itemName && String(di.itemName).trim() === String(item.itemName || item.model || '').trim())
            );
            if (deptItem && typeof deptItem.plannedQty === 'number' && deptItem.plannedQty > 0) resolvedQty = deptItem.plannedQty;
          }
          // 2. Try multiple field names from the purchase entry itself
          if (!resolvedQty) resolvedQty = Number(item.plannedQty) || Number(item.purchaseQty) || Number(item.originalIndentQty) || Number(item.poQty) || Number(item.qty) || 0;
          return { itemName: item.itemName || item.model || '', itemCode: item.itemCode || '', qty: resolvedQty, indentBy: item.indentBy || '', inStock: 0, indentClosed: false };
        });
        const first = group[0];
        const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === poNo);
        const dcNo = (match && match.dcNo && String(match.dcNo).trim() !== '') ? String(match.dcNo) : getNextDCNo(newIssues);

        let autoOaNo = match?.oaNo || '';
        let autoBatchNo = match?.batchNo || '';

        // *** FIX: use live psirData for batchNo/oaNo ***
        if (!autoBatchNo) autoBatchNo = getBatchNoFromPSIR(poNo);
        if (!autoOaNo) autoOaNo = getOaNoFromPSIR(poNo);

        // Fallback localStorage
        if (!autoOaNo || !autoBatchNo) {
          try {
            const psirRaw = localStorage.getItem('psirData');
            if (psirRaw) {
              const psirs = JSON.parse(psirRaw);
              if (Array.isArray(psirs)) {
                const psirMatch = psirs.find((p: any) => p.poNo === poNo);
                if (psirMatch) { autoOaNo = autoOaNo || psirMatch.oaNo || ''; autoBatchNo = autoBatchNo || psirMatch.batchNo || ''; }
              }
            }
          } catch {}
        }

        let autoVendorName = match?.vendorName || '';
        let autoVendorBatchNo = match?.vendorBatchNo || '';
        if (!autoVendorBatchNo) autoVendorBatchNo = getVendorBatchNoFromVSIR(poNo);
        if (!autoVendorBatchNo && group.length > 0) {
          const vbFromPO = group.find((item: any) => item.vendorBatchNo && String(item.vendorBatchNo).trim());
          if (vbFromPO) autoVendorBatchNo = vbFromPO.vendorBatchNo;
        }

        newIssues.push({ date: first?.orderPlaceDate || new Date().toISOString().slice(0, 10), materialPurchasePoNo: poNo, oaNo: autoOaNo, batchNo: autoBatchNo, vendorBatchNo: autoVendorBatchNo, dcNo, issueNo: getNextIssueNo(newIssues), vendorName: autoVendorName, items });
        added = true;
      }
    });

    if (added) {
      const deduped = deduplicateVendorIssues(newIssues);
      setIssues(deduped);
      if (userUid) {
        (async () => {
          try {
            await Promise.all(deduped.map(async (iss: any) => {
              // *** FIX: only write to Firestore if items have qty resolved — otherwise the
              //     sync effect will backfill qty and write then, avoiding a qty=0 save ***
              const allQtyZero = Array.isArray(iss.items) && iss.items.length > 0 && iss.items.every((it: any) => !it.qty || it.qty === 0);
              if (allQtyZero) { console.log('[VendorIssueModule] Skipping Firestore write for', iss.materialPurchasePoNo, '— qty=0, backfill will handle it'); return; }
              if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
              else await addVendorIssue(userUid, iss);
            }));
          } catch (err) { console.error('[VendorIssueModule] Failed to persist imported issues to Firestore:', err); try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
        })();
      }
    }
  }, [purchaseOrders, userUid, psirData, vendorDeptOrders]); // also depends on vendorDeptOrders for plannedQty

  useEffect(() => {
    if (issues.length === 0) return;
    let updated = false;
    const updatedIssues = issues.map(issue => {
      if (!issue.vendorBatchNo && issue.materialPurchasePoNo) {
        const vsirVB = getVendorBatchNoFromVSIR(issue.materialPurchasePoNo);
        if (vsirVB) { updated = true; return { ...issue, vendorBatchNo: vsirVB }; }
        const poEntry = purchaseOrders.find((po: any) => String(po.poNo || '').trim() === String(issue.materialPurchasePoNo || '').trim() && po.vendorBatchNo && String(po.vendorBatchNo).trim());
        if (poEntry) { updated = true; return { ...issue, vendorBatchNo: poEntry.vendorBatchNo }; }
      }
      return issue;
    });
    if (updated) {
      const deduped = deduplicateVendorIssues(updatedIssues);
      setIssues(deduped);
      if (userUid) {
        (async () => {
          try { await Promise.all(deduped.map(async (iss: any) => { if (iss.id) await updateVendorIssue(userUid, iss.id, iss); else await addVendorIssue(userUid, iss); })); }
          catch (err) { try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
        })();
      }
    }
  }, [vsirRecords, purchaseOrders, userUid]);

  const handleAddItem = () => {
    if (!itemInput.itemName || !itemInput.itemCode || !itemInput.indentBy || itemInput.qty <= 0) return;
    setNewIssue({ ...newIssue, items: [...newIssue.items, itemInput] });
    setItemInput({ itemName: '', itemCode: '', qty: 0, indentBy: '', inStock: 0, indentClosed: false });
  };

  const clearNewIssue = (updatedIssues: VendorIssue[]) => {
    setNewIssue({ date: '', materialPurchasePoNo: '', oaNo: '', batchNo: '', vendorBatchNo: '', dcNo: '', issueNo: getNextIssueNo(updatedIssues), vendorName: '', items: [] });
    setItemInput({ itemName: '', itemCode: '', qty: 0, indentBy: '', inStock: 0, indentClosed: false });
  };

  const handleAddIssue = () => {
    if (!newIssue.date || !newIssue.materialPurchasePoNo || newIssue.items.length === 0) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    const dcNo = match && match.dcNo && String(match.dcNo).trim() !== '' ? match.dcNo : getNextDCNo(issues);
    const updated = [...issues, { ...newIssue, dcNo, issueNo: getNextIssueNo(issues) }];
    const deduped = deduplicateVendorIssues(updated);
    setIssues(deduped);
    if (userUid) {
      (async () => {
        try { const last = deduped[deduped.length - 1]; if (last && !last.id) await addVendorIssue(userUid, last); }
        catch (err) { console.error('[VendorIssueModule] Failed to add Vendor Issue to Firestore:', err); try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
      })();
    } else { try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
    clearNewIssue(deduped);
  };

  const handleEditIssue = (idx: number) => {
    const issueToEdit = issues[idx];
    setNewIssue(issueToEdit);
    setEditIssueIdx(idx);
    if (issueToEdit.items && issueToEdit.items.length > 0) setItemInput(issueToEdit.items[0]);
  };

  const handleUpdateIssue = () => {
    if (editIssueIdx === null) return;
    if (newIssue.items.length > 0 && itemInput.itemName) { newIssue.items[0] = { ...itemInput }; }
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    const dcNo = match && match.dcNo && String(match.dcNo).trim() !== '' ? match.dcNo : issues[editIssueIdx].dcNo;
    const updated = issues.map((issue, idx) => idx === editIssueIdx ? { ...newIssue, dcNo } : issue);
    const deduped = deduplicateVendorIssues(updated);
    setIssues(deduped);
    if (userUid) {
      (async () => {
        try { await Promise.all(deduped.map(async (iss: any) => { if (iss.id) await updateVendorIssue(userUid, iss.id, iss); else await addVendorIssue(userUid, iss); })); }
        catch (err) { console.error('[VendorIssueModule] Failed to persist updated Vendor Issue to Firestore:', err); try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
      })();
    } else { try { localStorage.setItem('vendorIssueData', JSON.stringify(deduped)); } catch {} }
    clearNewIssue(deduped);
    setEditIssueIdx(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target as HTMLInputElement;
    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput(prev => ({ ...prev, itemName: value, itemCode: found ? found.itemCode : prev.itemCode }));
    } else if (name === 'qty' || name === 'inStock') {
      setItemInput(prev => ({ ...prev, [name]: value === '' ? 0 : parseInt(value, 10) }));
    } else {
      setItemInput(prev => ({ ...prev, [name]: value }));
    }
  };

  const [showDebug, setShowDebug] = useState(false);
  const debugInfo: string[] = [];
  if (newIssue.materialPurchasePoNo) {
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    if (!match) { debugInfo.push(`No Vendor Dept order for PO: ${newIssue.materialPurchasePoNo}`); }
    else if (!Array.isArray(match.items) || match.items.length === 0) { debugInfo.push(`VendorDept order for PO ${newIssue.materialPurchasePoNo} has no items.`); }
    else { match.items.forEach((item: any, idx: number) => { const pq = item.plannedQty; debugInfo.push(`Item[${idx}] ${item.itemName} (${item.itemCode}): ${typeof pq === 'number' ? `plannedQty=${pq} (used)` : `plannedQty not found, using qty=${item.qty || 0}`}`); }); }
    const psirBatch = getBatchNoFromPSIR(newIssue.materialPurchasePoNo);
    debugInfo.push(`PSIR batchNo for PO: "${psirBatch || '(not found)'}"`);
  } else { debugInfo.push('No Material Purchase PO No selected.'); }

  return (
    <div>
      <h2>Vendor Issue Module</h2>
      <button onClick={() => setShowDebug(d => !d)} style={{ marginBottom: 8, background: '#eee', border: '1px solid #ccc', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>
        {showDebug ? 'Hide Debug Panel' : 'Show Debug Panel'}
      </button>
      {showDebug && (
        <div style={{ background: '#222', color: '#fff', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          <strong>Debug Info:</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{debugInfo.map((msg, i) => <li key={i}>{msg}</li>)}</ul>
          <div style={{ marginTop: 8 }}>PSIR records loaded: {psirData.length}</div>
        </div>
      )}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <input type="date" placeholder="Date" value={newIssue.date} onChange={e => setNewIssue({ ...newIssue, date: e.target.value })} />
        <input placeholder="Material Purchase PO No" value={newIssue.materialPurchasePoNo} onChange={e => setNewIssue({ ...newIssue, materialPurchasePoNo: e.target.value })} />
        <input placeholder="Vendor Name" value={newIssue.vendorName} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0', width: 150 }} />
        <input placeholder="OA No" value={newIssue.oaNo} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }} />
        <input placeholder="Batch No" value={newIssue.batchNo} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }} />
        <input placeholder="Vendor Batch No" value={newIssue.vendorBatchNo} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0', width: 150 }} />
        <input placeholder="DC No" value={newIssue.dcNo} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }} />
        <input placeholder="Issue No" value={newIssue.issueNo} disabled style={{ background: '#eee' }} />
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>Item Name:</label>
        {itemNames.length > 0 ? (
          <select name="itemName" value={itemInput.itemName} onChange={e => {
            const value = e.target.value;
            const found = itemMaster.find(item => item.itemName === value);
            const foundCode = found ? found.itemCode : '';
            let plannedQty = 0;
            if (newIssue.materialPurchasePoNo) {
              const deptOrder = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
              if (deptOrder && Array.isArray(deptOrder.items)) {
                const deptItem = deptOrder.items.find((it: any) => it.itemName === value && it.itemCode === foundCode);
                if (deptItem && typeof deptItem.plannedQty === 'number') plannedQty = deptItem.plannedQty;
              }
            }
            setItemInput({ ...itemInput, itemName: value, itemCode: foundCode, qty: plannedQty });
          }}>
            <option value="">Select Item Name</option>
            {itemNames.map(name => (<option key={name} value={name}>{name}</option>))}
          </select>
        ) : (
          <input type="text" name="itemName" value={itemInput.itemName} onChange={handleChange} />
        )}
        <input placeholder="Item Code" name="itemCode" value={itemInput.itemCode} onChange={handleChange} readOnly={itemNames.length > 0} />
        <input type="number" placeholder="Qty" name="qty" value={itemInput.qty} onChange={handleChange} />
        <select name="indentBy" value={itemInput.indentBy} onChange={handleChange}>
          <option value="">Indent By</option>
          {indentByOptions.map(opt => (<option key={opt} value={opt}>{opt}</option>))}
        </select>
        <input type="number" placeholder="In Stock" name="inStock" value={itemInput.inStock} onChange={handleChange} />
        <label>
          <input type="checkbox" checked={itemInput.indentClosed} onChange={e => setItemInput({ ...itemInput, indentClosed: e.target.checked })} />
          Indent Closed
        </label>
        <button onClick={handleAddItem}>Add Item</button>
      </div>
      {newIssue.items.length > 0 && (
        <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
          <thead><tr><th>Item Name</th><th>Item Code</th><th>Qty</th><th>Indent By</th><th>In Stock</th><th>Indent Closed</th></tr></thead>
          <tbody>
            {newIssue.items.map((item, idx) => (
              <tr key={idx}><td>{item.itemName}</td><td>{item.itemCode}</td><td>{item.qty}</td><td>{item.indentBy}</td><td>{item.inStock}</td><td>{item.indentClosed ? 'Yes' : 'No'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={editIssueIdx !== null ? handleUpdateIssue : handleAddIssue}>
        {editIssueIdx !== null ? 'Update Vendor Issue' : 'Add Vendor Issue'}
      </button>
      <h3>Vendor Issues</h3>
      <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Date</th><th>Vendor Name</th><th>Material Purchase PO No</th><th>OA No</th>
            <th>Batch No</th><th>Vendor Batch No</th><th>DC No</th><th>Issue No</th>
            <th>Item Name</th><th>Item Code</th><th>Qty</th><th>Indent By</th>
            <th>In Stock</th><th>Indent Closed</th><th>Edit</th><th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {issues.length === 0 && (<tr><td colSpan={16} style={{ textAlign: 'center', color: '#888' }}>(No issues)</td></tr>)}
          {issues.flatMap((issue, idx) =>
            issue.items.map((item, i) => {
              const deptOrder = vendorDeptOrders.find(order => order.materialPurchasePoNo === issue.materialPurchasePoNo);
              const displayDcNo = deptOrder && deptOrder.dcNo && String(deptOrder.dcNo).trim() !== '' ? deptOrder.dcNo : issue.dcNo;
              return (
                <tr key={`${idx}-${i}`}>
                  <td>{issue.date}</td><td>{issue.vendorName}</td><td>{issue.materialPurchasePoNo}</td>
                  <td>{issue.oaNo}</td><td>{issue.batchNo}</td><td>{issue.vendorBatchNo}</td>
                  <td>{displayDcNo}</td><td>{issue.issueNo}</td><td>{item.itemName}</td>
                  <td>{item.itemCode}</td><td>{item.qty}</td><td>{item.indentBy}</td>
                  <td>{item.inStock}</td><td>{item.indentClosed ? 'Yes' : 'No'}</td>
                  <td><button type="button" style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEditIssue(idx)}>Edit</button></td>
                  <td>
                    <button type="button" onClick={(e) => {
                      e.preventDefault();
                      const toDelete = issues[idx];
                      if (!toDelete) return;
                      if (userUid && toDelete?.id) {
                        deleteVendorIssue(userUid, toDelete.id)
                          .then(() => setIssues(prev => prev.filter((_, i) => i !== idx)))
                          .catch((err) => console.error('[VendorIssueModule] Failed to delete from Firestore:', err));
                      } else {
                        setIssues(prev => { const updated = prev.filter((_, i) => i !== idx); try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {} return updated; });
                      }
                    }} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default VendorIssueModule;