const VSRI_MODULE_FIELDS = [
  { key: 'receivedDate', label: 'Received Date', type: 'date' },
  { key: 'indentNo', label: 'Indent No', type: 'text' },
  { key: 'poNo', label: 'PO No', type: 'text' },
  { key: 'oaNo', label: 'OA No', type: 'text' },
  { key: 'purchaseBatchNo', label: 'Purchase Batch No', type: 'text' },
  { key: 'vendorBatchNo', label: 'Vendor Batch No', type: 'text' },
  { key: 'dcNo', label: 'DC No', type: 'text' },
  { key: 'invoiceDcNo', label: 'Invoice / DC No', type: 'text' },
  { key: 'vendorName', label: 'Vendor Name', type: 'text' },
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
  { key: 'qtyReceived', label: 'Qty Received', type: 'number' },
  { key: 'okQty', label: 'OK Qty', type: 'number' },
  { key: 'reworkQty', label: 'Rework Qty', type: 'number' },
  { key: 'rejectQty', label: 'Reject Qty', type: 'number' },
  { key: 'grnNo', label: 'GRN No', type: 'text' },
  { key: 'remarks', label: 'Remarks', type: 'text' },
];

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { subscribePsirs } from '../utils/psirService';
import {
  subscribeVSIRRecords,
  addVSIRRecord,
  updateVSIRRecord,
  deleteVSIRRecord,
  subscribeVendorDepts,
  getItemMaster,
  getVendorIssues,
  subscribePurchaseData,
  subscribePurchaseOrders,
} from '../utils/firestoreServices';
import bus from '../utils/eventBus';

interface VSRIRecord {
  id: string;
  receivedDate: string;
  indentNo: string;
  poNo: string;
  oaNo: string;
  purchaseBatchNo: string;
  vendorBatchNo: string;
  dcNo: string;
  invoiceDcNo: string;
  vendorName: string;
  itemName: string;
  itemCode: string;
  qtyReceived: number;
  okQty: number;
  reworkQty: number;
  rejectQty: number;
  grnNo: string;
  remarks: string;
}

const EMPTY_ITEM_INPUT: VSRIRecord = {
  id: '',
  receivedDate: '',
  indentNo: '',
  poNo: '',
  oaNo: '',
  purchaseBatchNo: '',
  vendorBatchNo: '',
  dcNo: '',
  invoiceDcNo: '',
  vendorName: '',
  itemName: '',
  itemCode: '',
  qtyReceived: 0,
  okQty: 0,
  reworkQty: 0,
  rejectQty: 0,
  grnNo: '',
  remarks: '',
};

const VSIRModule: React.FC = () => {
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<any[]>([]);
  const [vendorIssues, setVendorIssues] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [psirData, setPsirData] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [records, setRecords] = useState<VSRIRecord[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Robustness toggles
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(false);
  const [autoImportEnabled, setAutoImportEnabled] = useState(false);

  const [itemInput, setItemInput] = useState<VSRIRecord>({ ...EMPTY_ITEM_INPUT });

  // Track existing PO+ItemCode combinations to prevent duplicates during import
  const existingCombinationsRef = useRef<Set<string>>(new Set());

  // Keep latest records in a ref so async callbacks always see fresh data
  const recordsRef = useRef<VSRIRecord[]>([]);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  // Keep refs for other state that async callbacks need
  const userUidRef = useRef<string | null>(null);
  useEffect(() => {
    userUidRef.current = userUid;
  }, [userUid]);

  const purchaseDataRef = useRef<any[]>([]);
  useEffect(() => {
    purchaseDataRef.current = purchaseData;
  }, [purchaseData]);

  const purchaseOrdersRef = useRef<any[]>([]);
  useEffect(() => {
    purchaseOrdersRef.current = purchaseOrders;
  }, [purchaseOrders]);

  const vendorDeptOrdersRef = useRef<any[]>([]);
  useEffect(() => {
    vendorDeptOrdersRef.current = vendorDeptOrders;
  }, [vendorDeptOrders]);

  // Helper: create a composite key for deduplication
  const makeKey = (poNo: string, itemCode: string) =>
    `${String(poNo).trim().toLowerCase()}|${String(itemCode).trim().toLowerCase()}`;

  // Helper: deduplicate VSIR records by poNo+itemCode (keep latest occurrence)
  const deduplicateVSIRRecords = (arr: VSRIRecord[]): VSRIRecord[] => {
    const map = new Map<string, VSRIRecord>();
    for (const rec of arr) {
      const key = makeKey(rec.poNo, rec.itemCode);
      map.set(key, rec);
    }
    return Array.from(map.values());
  };

  // Initialize component
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  // Subscribe to Firestore and load master data when authenticated
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);
      userUidRef.current = uid;
      if (!uid) return;

      // Subscribe to VSIR records — Firestore is source of truth, just set state
      const unsubVSIR = subscribeVSIRRecords(uid, (docs) => {
        try {
          const dedupedDocs = deduplicateVSIRRecords(
            docs.map((d: any) => ({ ...d })) as VSRIRecord[]
          );
          recordsRef.current = dedupedDocs;
          setRecords(dedupedDocs);
        } catch (e) {
          console.error('[VSIR] Error mapping vsir docs', e);
        }
      });

      // Subscribe to vendorDept orders
      const unsubVendorDepts = subscribeVendorDepts(uid, (docs: any[]) => {
        setVendorDeptOrders(docs || []);
        vendorDeptOrdersRef.current = docs || [];
      });

      // Subscribe to PSIR records from Firestore
      const unsubPsirs = subscribePsirs(uid, (docs: any[]) => {
        console.debug('[VSIR] PSIR records updated:', docs.length, 'records');
        setPsirData(docs || []);
      });

      // Subscribe to purchaseData in real-time
      const unsubPurchaseData = subscribePurchaseData(uid, (docs: any[]) => {
        console.log('[VSIR] ✅ Purchase data subscription updated:', docs.length, 'records');
        if (docs.length > 0) {
          console.log('[VSIR] First purchase data entry:', docs[0]);
        }
        setPurchaseData(docs || []);
        purchaseDataRef.current = docs || [];
      });

      // Subscribe to purchaseOrders in real-time
      const unsubPurchaseOrders = subscribePurchaseOrders(uid, (docs: any[]) => {
        console.log('[VSIR] ✅ Purchase orders subscription updated:', docs.length, 'records');
        if (docs.length > 0) {
          console.log('[VSIR] First purchase order entry:', docs[0]);
        }
        setPurchaseOrders(docs || []);
        purchaseOrdersRef.current = docs || [];
      });

      // Load one-time master collections
      (async () => {
        try {
          const items = await getItemMaster(uid);
          setItemMaster((items || []) as any[]);
          setItemNames((items || []).map((i: any) => i.itemName).filter(Boolean));
        } catch (e) {
          console.error('[VSIR] getItemMaster failed', e);
        }
        try {
          const vi = await getVendorIssues(uid);
          setVendorIssues(vi || []);
        } catch (e) {
          console.error('[VSIR] getVendorIssues failed', e);
        }
      })();

      return () => {
        try { unsubVSIR(); } catch {}
        try { unsubVendorDepts(); } catch {}
        try { unsubPsirs(); } catch {}
        try { unsubPurchaseData(); } catch {}
        try { unsubPurchaseOrders(); } catch {}
      };
    });

    return () => {
      try { unsubAuth(); } catch {}
    };
  }, []);

  // Auto-delete all VSIR records if purchaseData is empty (separate, non-nested effect)
  useEffect(() => {
    const runAutoDelete = async () => {
      if (!autoDeleteEnabled) return;
      if (!userUid || typeof userUid !== 'string') {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: userUid is missing or invalid.', userUid);
        return;
      }
      if (!Array.isArray(purchaseData) || !Array.isArray(records)) {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: purchaseData or records is not an array.');
        return;
      }
      if (purchaseData.length === 0 && records.length > 0) {
        if (!window.confirm('Auto-delete all VSIR records because purchaseData is empty? This cannot be undone.')) {
          return;
        }
        console.log('[VSIR][DEBUG] Triggering auto-delete');
        for (const rec of records) {
          try {
            if (!rec || !rec.id) {
              console.log('[VSIR][DEBUG] Skipping invalid record:', rec);
              continue;
            }
            await deleteVSIRRecord(userUid, String(rec.id));
            console.log('[VSIR][DEBUG] Successfully auto-deleted VSIR record:', rec.id);
          } catch (e) {
            const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
            alert('[VSIR][DEBUG] Failed to auto-delete VSIR record: ' + rec.id + '\nError: ' + errMsg);
            console.error('[VSIR][DEBUG] Failed to auto-delete VSIR record:', rec.id, e);
          }
        }
      } else {
        console.log('[VSIR][DEBUG] Auto-delete not triggered. purchaseData.length:', purchaseData.length, 'records.length:', records.length);
      }
    };
    runAutoDelete();
  }, [userUid, purchaseData, autoDeleteEnabled]);

  // Update the existing combinations ref whenever records change
  useEffect(() => {
    existingCombinationsRef.current = new Set(
      records.map((r) => `${String(r.poNo).trim().toLowerCase()}|${String(r.itemCode).trim().toLowerCase()}`)
    );
    console.log('[VSIR] Updated dedup cache with', existingCombinationsRef.current.size, 'combinations');
  }, [records]);

  // Auto-fill Indent No from PSIR for all records that have poNo but missing indentNo
  useEffect(() => {
    if (!isInitialized || records.length === 0 || psirData.length === 0) return;
    console.log('[VSIR] Auto-filling Indent No from Firestore PSIRs');

    let updated = false;
    const updatedRecords = records.map((record) => {
      if (record.poNo && (!record.indentNo || record.indentNo.trim() === '')) {
        for (const psir of psirData) {
          if (psir.poNo && psir.poNo.toString().trim() === record.poNo.toString().trim()) {
            const indentNo = psir.indentNo || '';
            if (indentNo && indentNo !== record.indentNo) {
              updated = true;
              return { ...record, indentNo };
            }
            break;
          }
        }
      }
      return record;
    });

    if (updated) {
      setRecords(updatedRecords);
      if (userUid) {
        updatedRecords.forEach(async (rec) => {
          if (rec.id) {
            try {
              await updateVSIRRecord(userUid, String(rec.id), rec);
            } catch (err) {
              console.error('[VSIR] Error persisting auto-filled indentNo:', err);
            }
          }
        });
      }
    }
  }, [isInitialized, psirData]);
  // NOTE: Intentionally omitting `records` from deps to avoid re-triggering on every record change.
  // This effect is meant to run only when psirData updates.

  // Dispatch vsir.updated event when records change
  useEffect(() => {
    if (!isInitialized) return;
    try {
      bus.dispatchEvent(new CustomEvent('vsir.updated', { detail: { records } }));
    } catch (err) {
      console.error('[VSIR] Error dispatching vsir.updated event:', err);
    }
  }, [records, isInitialized]);

  // Sync vendor batch from VendorDept — uses recordsRef to always have fresh data
  const syncVendorBatchFromDept = useCallback(() => {
    try {
      console.log('[VSIR-DEBUG] ========== SYNC CHECK ==========');
      const vendorDepts = vendorDeptOrdersRef.current || []; // Removed stray 'event'
      if (!vendorDepts || vendorDepts.length === 0) {
        console.log('[VSIR-DEBUG] No vendorDeptData found for sync');
        return;
      }

      const currentRecords = recordsRef.current;
      let updated = false;
      const updatedRecords = currentRecords.map((record) => {
        const hasEmptyVendorBatchNo = !record.vendorBatchNo || !String(record.vendorBatchNo).trim();
        const hasPoNo = !!record.poNo;
        const hasInvoiceDcNo = record.invoiceDcNo && String(record.invoiceDcNo).trim();

        if (hasEmptyVendorBatchNo && hasPoNo && hasInvoiceDcNo) {
          const match = vendorDepts.find((vd: any) => {
            return String(vd.materialPurchasePoNo || '').trim() === String(record.poNo || '').trim();
          });
          if (match?.vendorBatchNo) {
            console.log(`[VSIR-DEBUG] ✓ SYNC: Found match for PO ${record.poNo}, syncing vendorBatchNo: ${match.vendorBatchNo}`);
            updated = true;
            return { ...record, vendorBatchNo: match.vendorBatchNo };
          }
        }
        return record;
      });

      if (updated) {
        console.log('[VSIR-DEBUG] ✓ Records updated, persisting');
        recordsRef.current = updatedRecords;
        setRecords(updatedRecords);
      } else {
        console.log('[VSIR-DEBUG] No records needed updating');
      }
    } catch (err) {
      console.error('[VSIR][SyncVendorBatch] Error:', err);
    }
  }, []); // no deps — reads from refs

  // Register vendorDept.updated listener and run sync when vendorDeptOrders changes
  useEffect(() => {
    const handleVendorDeptUpdate = () => {
      console.log('[VSIR-DEBUG] vendorDept.updated event received');
      syncVendorBatchFromDept();
    };
    bus.addEventListener('vendorDept.updated', handleVendorDeptUpdate);
    syncVendorBatchFromDept();
    return () => {
      bus.removeEventListener('vendorDept.updated', handleVendorDeptUpdate);
    };
  }, [vendorDeptOrders, syncVendorBatchFromDept]);
  // NOTE: dep on vendorDeptOrders (not records) so sync only fires when vendor data changes, not on every record mutation

  // Auto-fill Indent No from PSIR when PO No changes
  useEffect(() => {
    if (!itemInput.poNo) return;
    try {
      const psirs = psirData || [];
      if (!Array.isArray(psirs) || psirs.length === 0) return;
      for (const psir of psirs) {
        if (psir.poNo && psir.poNo.toString().trim() === itemInput.poNo.toString().trim()) {
          const indentNo = psir.indentNo || '';
          setItemInput((prev) => ({ ...prev, indentNo }));
          return;
        }
      }
    } catch (e) {
      console.error('[VSIR] Error auto-filling indent no:', e);
    }
  }, [itemInput.poNo]);

  // Helpers to robustly detect PO number and item arrays from various purchase shapes
  const getOrderPoNo = (order: any) => {
    if (!order || typeof order !== 'object') return undefined;
    const candidates = ['poNo', 'materialPurchasePoNo', 'po_no', 'poNumber', 'purchasePoNo', 'poNumberStr'];
    for (const k of candidates) {
      if (order[k]) return order[k];
    }
    for (const k of Object.keys(order)) {
      if (/po/i.test(k) && order[k]) return order[k];
    }
    return undefined;
  };

  const looksLikeItem = (obj: any) => {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    return (
      keys.includes('itemcode') ||
      keys.includes('item_name') ||
      keys.includes('itemname') ||
      keys.includes('model') ||
      keys.includes('code') ||
      keys.includes('name')
    );
  };

  const getOrderItems = (order: any) => {
    if (!order || typeof order !== 'object') return [];
    if (looksLikeItem(order)) return [order];
    const itemKeys = ['items', 'materials', 'products', 'lines', 'orderItems', 'itemsList'];
    for (const k of itemKeys) {
      if (Array.isArray(order[k]) && order[k].length > 0) return order[k];
    }
    for (const v of Object.values(order)) {
      if (Array.isArray(v) && v.length > 0 && looksLikeItem(v[0])) return v;
    }
    if (Array.isArray(order) && order.length > 0 && looksLikeItem(order[0])) return order;
    return [];
  };

  const runImport = async (providedSource?: any[]) => {
    const uid = userUidRef.current;
    if (!uid) {
      console.log('[VSIR] Manual import skipped: no userUid');
      return;
    }
    const poSrc = purchaseOrdersRef.current;
    const pdSrc = purchaseDataRef.current;
    const sourceData =
      providedSource ?? ((Array.isArray(poSrc) && poSrc.length > 0) ? poSrc : pdSrc);

    if (!Array.isArray(sourceData) || sourceData.length === 0) {
      console.log('[VSIR] Manual import skipped: no source data available');
      return;
    }

    console.log('[VSIR] ========== RUN IMPORT ==========');
    try {
      const currentCombinations = existingCombinationsRef.current;
      let importCount = 0;

      for (let orderIdx = 0; orderIdx < sourceData.length; orderIdx++) {
        const order: any = sourceData[orderIdx];
        const poNo = getOrderPoNo(order);
        if (!poNo) continue;

        const items = getOrderItems(order);
        if (!Array.isArray(items) || items.length === 0) continue;

        const vendorDeptMatch = vendorDeptOrdersRef.current.find(
          (v: any) => (v.materialPurchasePoNo || '').toString().trim() === poNo.toString().trim()
        );
        const oaNo = vendorDeptMatch?.oaNo || '';
        const batchNo = vendorDeptMatch?.batchNo || '';

        for (const item of items) {
          const itemCode = item.itemCode || '';
          const dedupeKey = `${String(poNo).trim().toLowerCase()}|${String(itemCode).trim().toLowerCase()}`;

          if (currentCombinations.has(dedupeKey)) {
            console.log(`[VSIR] skipping duplicate: ${dedupeKey}`);
            continue;
          }

          const newRecord: VSRIRecord = {
            id: Math.random().toString(36).slice(2),
            receivedDate: '',
            indentNo: '',
            poNo,
            oaNo,
            purchaseBatchNo: batchNo,
            vendorBatchNo: '',
            dcNo: '',
            invoiceDcNo: '',
            vendorName: '',
            itemName: item.itemName || item.model || '',
            itemCode,
            qtyReceived: item.qty || 0,
            okQty: 0,
            reworkQty: 0,
            rejectQty: 0,
            grnNo: '',
            remarks: '',
          };

          try {
            await addVSIRRecord(uid, newRecord);
            importCount++;
            console.log('[VSIR] ✅ imported', dedupeKey);
          } catch (err) {
            console.error('[VSIR] ❌ failed to import', dedupeKey, err);
          }
        }
      }
      console.log('[VSIR] Import complete. total imported:', importCount);
    } catch (e) {
      console.error('[VSIR] Error running import:', e);
    }
  };

  // Automatic run when data or auth changes
  useEffect(() => {
    if (!autoImportEnabled) return;
    if (!window.confirm('Auto-import from purchase data/orders? This may overwrite existing VSIR records.')) return;
    runImport();
  }, [purchaseOrders, purchaseData, vendorDeptOrders, userUid, autoImportEnabled]);

  // Fill missing OA/Batch from PSIR/VendorDept (once on mount)
  useEffect(() => {
    if (records.length === 0) return;
    try {
      const psirs = psirData || [];
      const vendorDepts = vendorDeptOrders || [];
      const vendorIssuesList = vendorIssues || [];
      let updated = false;

      const updatedRecords = records.map((record) => {
        if ((!record.oaNo || !record.purchaseBatchNo) && record.poNo) {
          let oaNo = record.oaNo;
          let batchNo = record.purchaseBatchNo;

          if (!oaNo || !batchNo) {
            const psirMatch = psirs.find((p: any) => p.poNo === record.poNo);
            if (psirMatch) {
              oaNo = oaNo || psirMatch.oaNo || '';
              batchNo = batchNo || psirMatch.batchNo || '';
            }
          }
          if ((!oaNo || !batchNo) && vendorDepts.length) {
            const deptMatch = vendorDepts.find((v: any) => v.materialPurchasePoNo === record.poNo);
            if (deptMatch) {
              oaNo = oaNo || deptMatch.oaNo || '';
              batchNo = batchNo || deptMatch.batchNo || '';
            }
          }
          if ((!oaNo || !batchNo) && vendorIssuesList.length) {
            const issueMatch = vendorIssuesList.find((vi: any) => vi.materialPurchasePoNo === record.poNo);
            if (issueMatch) {
              oaNo = oaNo || issueMatch.oaNo || '';
              batchNo = batchNo || issueMatch.batchNo || '';
            }
          }
          if (oaNo !== record.oaNo || batchNo !== record.purchaseBatchNo) {
            updated = true;
            return { ...record, oaNo, purchaseBatchNo: batchNo };
          }
        }
        return record;
      });

      if (updated) {
        setRecords(updatedRecords);
      }
    } catch (e) {
      console.error('[VSIR][FillMissing] Error:', e);
    }
  }, []); // intentionally runs once on mount only

  // Auto-fill when PO changes in item input form
  useEffect(() => {
    if (!itemInput.poNo) return;

    let oaNo = '';
    let batchNo = '';
    let vendorName = '';

    const deptMatch = (vendorDeptOrders || []).find(
      (v: any) => v.materialPurchasePoNo === itemInput.poNo
    );
    if (deptMatch) {
      oaNo = deptMatch.oaNo || '';
      batchNo = deptMatch.batchNo || '';
      vendorName = deptMatch.vendorName || '';
    }

    if (!oaNo || !batchNo) {
      const psirMatch = psirData.find((p: any) => p.poNo === itemInput.poNo);
      if (psirMatch) {
        oaNo = oaNo || psirMatch.oaNo || '';
        batchNo = batchNo || psirMatch.batchNo || '';
      }
    }

    if (!oaNo || !batchNo || !vendorName) {
      const issueMatch = vendorIssues.find((vi: any) => vi.materialPurchasePoNo === itemInput.poNo);
      if (issueMatch) {
        oaNo = oaNo || issueMatch.oaNo || '';
        batchNo = batchNo || issueMatch.batchNo || '';
        vendorName = vendorName || issueMatch.vendorName || '';
      }
    }

    setItemInput((prev) => ({
      ...prev,
      oaNo: oaNo || prev.oaNo,
      purchaseBatchNo: batchNo || prev.purchaseBatchNo,
      vendorName: vendorName || prev.vendorName,
    }));
  }, [itemInput.poNo, vendorDeptOrders]);

  // Auto-fill when itemCode changes in item input form
  useEffect(() => {
    if (!itemInput.itemCode) return;
    try {
      const issues = vendorIssues || [];
      if (!issues.length) return;

      let source: any = null;
      if (itemInput.poNo) {
        source = issues.find(
          (v: any) => String(v.materialPurchasePoNo).trim() === String(itemInput.poNo).trim()
        );
      } else {
        source = issues.find(
          (v: any) =>
            Array.isArray(v.items) &&
            v.items.some((it: any) => String(it.itemCode).trim() === String(itemInput.itemCode).trim())
        );
      }

      if (source) {
        setItemInput((prev) => ({
          ...prev,
          receivedDate: prev.receivedDate || source.date || prev.receivedDate,
          poNo: prev.poNo || source.materialPurchasePoNo || prev.poNo,
          vendorName: prev.vendorName || source.vendorName || prev.vendorName,
        }));
      }
    } catch {}
  }, [itemInput.itemCode]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === 'itemName') {
      const found = itemMaster.find((item) => item.itemName === value);
      setItemInput((prev) => ({
        ...prev,
        itemName: value,
        itemCode: found ? found.itemCode : '',
      }));
    } else {
      setItemInput((prev) => ({
        ...prev,
        [name]: type === 'number' ? Number(value) : value,
      }));
    }
  };

  const generateVendorBatchNo = (): string => {
    const yy = String(new Date().getFullYear()).slice(2);
    let maxNum = 0;
    try {
      recordsRef.current.forEach((r) => {
        const match = (r as any).vendorBatchNo?.match?.(new RegExp(`${yy}/V(\\d+)`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
      (vendorDeptOrders || []).forEach((d: any) => {
        const match = d.vendorBatchNo?.match?.(new RegExp(`${yy}/V(\\d+)`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
    } catch (e) {
      console.error('[VSIR] Error in generateVendorBatchNo:', e);
    }
    return `${yy}/V${maxNum + 1}`;
  };

  const getVendorBatchNoForPO = (poNo: string): string => {
    if (!poNo) return '';
    try {
      const match = (vendorDeptOrders || []).find((d: any) => d.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}
    try {
      const match = (vendorIssues || []).find((i: any) => i.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}
    return '';
  };

  const handleEdit = (idx: number) => {
    const record = records[idx];
    let edited = { ...record };
    if (!edited.vendorBatchNo?.trim() && edited.poNo) {
      let vb = getVendorBatchNoForPO(edited.poNo);
      if (!vb) vb = generateVendorBatchNo();
      edited.vendorBatchNo = vb;
    }
    setItemInput(edited);
    setEditIdx(idx);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalItemInput = { ...itemInput };

    const hasInvoiceDcNo = finalItemInput.invoiceDcNo && String(finalItemInput.invoiceDcNo).trim();
    if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim() && finalItemInput.poNo) {
      let vb = getVendorBatchNoForPO(finalItemInput.poNo);
      if (!vb) {
        console.log('[VSIR] Vendor Batch No not found for PO:', finalItemInput.poNo);
        vb = '';
      }
      finalItemInput.vendorBatchNo = vb;
    } else if (!hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      finalItemInput.vendorBatchNo = '';
    }

    if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      alert('⚠️ Vendor Batch No could not be determined from VendorDept. Please save a VendorDept order for this PO first.');
      return;
    }

    const key = makeKey(finalItemInput.poNo, finalItemInput.itemCode);
    const existingIdx = recordsRef.current.findIndex((r) => makeKey(r.poNo, r.itemCode) === key);

    if (existingIdx !== -1) {
      // Update existing record
      const firestoreId = recordsRef.current[existingIdx].id;
      const updatedRecord = { ...recordsRef.current[existingIdx], ...finalItemInput, id: firestoreId };

      if (userUid && firestoreId) {
        try {
          await updateVSIRRecord(userUid, String(firestoreId), updatedRecord);
          // Firestore subscription will update records state automatically
          console.log('[VSIR] ✅ Updated record in Firestore:', firestoreId);
        } catch (err) {
          console.error('[VSIR] Error updating VSIR in Firestore:', err);
        }
      } else {
        // No Firestore — update local state directly
        const updatedRecords = [...recordsRef.current];
        updatedRecords[existingIdx] = updatedRecord;
        setRecords(deduplicateVSIRRecords(updatedRecords));
      }
    } else {
      // Add new record
      if (userUid) {
        try {
          await addVSIRRecord(userUid, { ...finalItemInput });
          // Firestore subscription will update records state automatically
          console.log('[VSIR] ✅ Added new record to Firestore');
        } catch (err) {
          console.error('[VSIR] Error adding VSIR to Firestore:', err);
        }
      } else {
        // Not logged in — update local state directly
        const newRecord = { ...finalItemInput, id: Math.random().toString(36).slice(2) };
        setRecords(deduplicateVSIRRecords([...recordsRef.current, newRecord]));
      }
    }

    setEditIdx(null);
    // Do NOT reset form after submit
  };

  const handleDelete = async (idx: number) => {
    const toDelete = records[idx];
    if (!toDelete) {
      console.error('[VSIR] No record found to delete at index', idx);
      return;
    }
    console.log('[VSIR] Deleting record:', toDelete);

    if (userUid && toDelete.id) {
      try {
        await deleteVSIRRecord(userUid, String(toDelete.id));
        console.log('[VSIR] Successfully deleted from Firestore:', toDelete.id);
        // Firestore subscription will update records state automatically.
        // But also update local state immediately for fast UI feedback:
        setRecords((prev) => prev.filter((r) => r.id !== toDelete.id));
      } catch (e: any) {
        console.error('[VSIR] deleteVSIRRecord failed:', e, 'Record ID:', toDelete.id);
        alert(
          'Failed to delete record from Firestore. Please check your permissions and network.\nError: ' +
            (e && e.message ? e.message : e)
        );
      }
    } else {
      // No Firestore — remove locally
      setRecords((prev) => prev.filter((r) => r.id !== toDelete.id));
    }
  };

  return (
    <div>
      <h2>VSRI Module</h2>
      <div>
        <label>
          <input
            type="checkbox"
            checked={autoDeleteEnabled}
            onChange={(e) => setAutoDeleteEnabled(e.target.checked)}
          />{' '}
          Enable Auto-Delete (dangerous)
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoImportEnabled}
            onChange={(e) => setAutoImportEnabled(e.target.checked)}
          />{' '}
          Enable Auto-Import (dangerous)
        </label>
      </div>
      <form onSubmit={handleSubmit}>
        {VSRI_MODULE_FIELDS.map((field) => (
          <div key={field.key}>
            <label>{field.label}</label>
            {field.key === 'itemName' && itemNames.length > 0 ? (
              <select name={field.key} value={(itemInput as any)[field.key]} onChange={handleChange}>
                <option value="">Select Item Name</option>
                {itemNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.key}
                value={(itemInput as any)[field.key]}
                onChange={handleChange}
              />
            )}
          </div>
        ))}
        <button type="submit">{editIdx !== null ? 'Update' : 'Add'}</button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {VSRI_MODULE_FIELDS.map((field) => (
              <th key={field.key}>{field.label}</th>
            ))}
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {records.map((rec, idx) => (
            <tr key={rec.id}>
              {VSRI_MODULE_FIELDS.map((field) => {
                const cellCommon: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid #ccc' };
                if (field.key === 'dcNo') {
                  return <td key={field.key} style={cellCommon}>{rec.dcNo}</td>;
                }
                if (field.key === 'vendorBatchNo') {
                  const vendorBatchNo = rec.vendorBatchNo || getVendorBatchNoForPO(rec.poNo) || '';
                  return <td key={field.key} style={cellCommon}>{vendorBatchNo}</td>;
                }
                return <td key={field.key} style={cellCommon}>{(rec as any)[field.key]}</td>;
              })}
              <td>
                <button
                  onClick={() => handleEdit(idx)}
                  style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 2, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}
                >
                  Edit
                </button>
              </td>
              <td>
                <button
                  onClick={() => handleDelete(idx)}
                  style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 2, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default VSIRModule;