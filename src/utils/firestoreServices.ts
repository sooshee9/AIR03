import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from './logger';

// ============ PURCHASE ORDERS ============
export const subscribePurchaseOrders = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'purchaseOrders');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to purchaseOrders:', error);
    cb([]);
  });
  return unsub;
};

export const getPurchaseOrders = async (uid: string) => {
  try {
    if (!uid) {
      console.warn('[FirestoreServices] getPurchaseOrders called with empty uid');
      return [];
    }
    const col = collection(db, 'users', uid, 'purchaseOrders');
    const snap = await getDocs(col);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.debug('[FirestoreServices] getPurchaseOrders retrieved', data.length, 'records for user:', uid);
    return data;
  } catch (error) {
    console.error('[FirestoreServices] Error getting purchaseOrders for user', uid, ':', error);
    return [];
  }
};

export const addPurchaseOrder = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'purchaseOrders');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding purchaseOrder:', error);
    throw error;
  }
};

export const updatePurchaseOrder = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'purchaseOrders', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating purchaseOrder:', error);
    throw error;
  }
};

// ============ VENDOR DEPARTMENTS ============
export const subscribeVendorDepts = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vendorDepts');
  const unsub = onSnapshot(col, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vendorDepts:', error);
    cb([]);
  });
  return unsub;
};

export const getVendorDepts = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vendorDepts');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vendorDepts:', error);
    return [];
  }
};

// ============ VENDOR ISSUES ============
export const subscribeVendorIssues = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vendorIssues');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vendorIssues:', error);
    cb([]);
  });
  return unsub;
};

export const getVendorIssues = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vendorIssues');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vendorIssues:', error);
    return [];
  }
};

export const addVendorIssue = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'vendorIssues');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding vendorIssue:', error);
    throw error;
  }
};

export const updateVendorIssue = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorIssues', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating vendorIssue:', error);
    throw error;
  }
};

export const deleteVendorIssue = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorIssues', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting vendorIssue:', error);
    throw error;
  }
};

// ============ VENDOR STOCK ISSUE RECORDS (VSIR) ============
export const subscribeVSIRRecords = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vsirRecords');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vsirRecords:', error);
    cb([]);
  });
  return unsub;
};

export const getVSIRRecords = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vsirRecords');
    const q = query(col, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vsirRecords:', error);
    return [];
  }
};

export const addVSIRRecord = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'vsirRecords');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding vsirRecord:', error);
    throw error;
  }
};

export const updateVSIRRecord = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'vsirRecords', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating vsirRecord:', error);
    throw error;
  }
};

export const deleteVSIRRecord = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'vsirRecords', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting vsirRecord:', error);
    throw error;
  }
};

// ============ PURCHASE DATA ============
export const getPurchaseData = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'purchaseData');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting purchaseData:', error);
    return [];
  }
};

export const updatePurchaseData = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'purchaseData', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating purchaseData:', error);
    throw error;
  }
};

// ============ INDENT DATA ============
export const getIndentData = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'indentData');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting indentData:', error);
    return [];
  }
};

// ============ STOCK RECORDS ============
export const getStockRecords = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting stockRecords:', error);
    return [];
  }
};

export const addStockRecord = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding stockRecord:', error);
    throw error;
  }
};

export const updateStockRecord = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'stockRecords', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating stockRecord:', error);
    throw error;
  }
};

export const deleteStockRecord = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'stockRecords', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting stockRecord:', error);
    throw error;
  }
};

export const subscribeStockRecords = (uid: string, cb: (docs: any[]) => void) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const q = query(col, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(docs);
    }, (error) => {
      logger.error('[FirestoreServices] Error subscribing to stockRecords:', error);
      cb([]);
    });
    return unsub;
  } catch (error) {
    logger.error('[FirestoreServices] subscribeStockRecords failed:', error);
    return () => {};
  }
};

// ============ ITEM MASTER ============
export const subscribeItemMaster = (uid: string, cb: (docs: any[]) => void) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const unsub = onSnapshot(col, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(docs);
    }, (error) => {
      logger.error('[FirestoreServices] Error subscribing to itemMaster:', error);
      cb([]);
    });
    return unsub;
  } catch (error) {
    logger.error('[FirestoreServices] subscribeItemMaster failed:', error);
    return () => {};
  }
};

export const getItemMaster = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting itemMaster:', error);
    return [];
  }
};

export const addItemMaster = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding itemMaster:', error);
    throw error;
  }
};

export const updateItemMaster = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'itemMaster', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating itemMaster:', error);
    throw error;
  }
};

export const deleteItemMaster = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'itemMaster', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting itemMaster:', error);
    throw error;
  }
};
