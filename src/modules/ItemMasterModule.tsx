import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';

interface ItemMasterRecord {
  id: string;
  itemName: string;
  itemCode: string;
}

const LOCAL_STORAGE_KEY = 'itemMasterData'; // Keep for migration only

const ITEM_MASTER_FIELDS = [
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
];

const ItemMasterModule: React.FC = () => {
  const [records, setRecords] = useState<ItemMasterRecord[]>([]);
  const [form, setForm] = useState({
    itemName: '',
    itemCode: '',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<string | null>(null);

  // Migrate existing localStorage item master entries into Firestore on sign-in
  // Subscribe to Firestore for realtime data
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);

      if (uid) {
        // Migrate localStorage if exists
        (async () => {
          try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) {
              const arr = JSON.parse(raw || '[]');
              if (Array.isArray(arr) && arr.length > 0) {
                for (const it of arr) {
                  try {
                    const payload = { ...it } as any;
                    if (typeof payload.id !== 'undefined') delete payload.id;
                    const col = collection(db, 'userData', uid, 'itemMasterData');
                    await addDoc(col, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                  } catch (err) {
                    console.warn('[ItemMasterModule] migration addDoc failed for item', it, err);
                  }
                }
                try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch {}
              }
            }
          } catch (err) {
            console.error('[ItemMasterModule] Migration failed:', err);
          }
        })();
      }
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // Subscribe to Firestore itemMasterData collection for realtime updates
  useEffect(() => {
    let unsub: (() => void) | null = null;
    if (userUid) {
      try {
        const col = collection(db, 'userData', userUid, 'itemMasterData');
        unsub = onSnapshot(col, (snap) => {
          const mapped = snap.docs.map(d => ({
            id: d.id,
            itemName: d.data().itemName || '',
            itemCode: d.data().itemCode || '',
          } as ItemMasterRecord));
          setRecords(mapped);
        });
      } catch (err) {
        console.error('[ItemMasterModule] Firestore subscription error:', err);
      }
    } else {
      setRecords([]);
    }
    return () => { try { if (unsub) unsub(); } catch {} };
  }, [userUid]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.itemName || !form.itemCode) {
      alert('Item Name and Item Code are required.');
      return;
    }

    if (editIdx !== null) {
      // Update existing record in Firestore
      const rec = records[editIdx];
      if (userUid && rec.id) {
        try {
          const docRef = doc(db, 'userData', userUid, 'itemMasterData', rec.id);
          await updateDoc(docRef, {
            itemName: form.itemName,
            itemCode: form.itemCode,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.error('[ItemMasterModule] Failed to update record in Firestore:', err);
          alert('Failed to update record.');
        }
      }
      setEditIdx(null);
    } else {
      // Add new record to Firestore
      if (userUid) {
        try {
          const col = collection(db, 'userData', userUid, 'itemMasterData');
          await addDoc(col, {
            itemName: form.itemName,
            itemCode: form.itemCode,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.error('[ItemMasterModule] Failed to add record to Firestore:', err);
          alert('Failed to add record.');
        }
      }
    }

    setForm({
      itemName: '',
      itemCode: '',
    });
  };

  const handleEdit = (idx: number) => {
    setForm(records[idx]);
    setEditIdx(idx);
  };

  // Delete handler
  const handleDelete = async (idx: number) => {
    const rec = records[idx];
    if (userUid && rec.id) {
      try {
        const docRef = doc(db, 'userData', userUid, 'itemMasterData', rec.id);
        await deleteDoc(docRef);
        // Don't update local state — let Firestore subscription auto-update
      } catch (err) {
        console.error('[ItemMasterModule] Failed to delete record from Firestore:', err);
        alert('Failed to delete record.');
      }
    }
  };

  return (
    <div>
      <h2>Item Master Module</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        {ITEM_MASTER_FIELDS.map((field) => (
          <div key={field.key} style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{field.label}</label>
            <input
              type={field.type}
              name={field.key}
              value={(form as any)[field.key]}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
            />
          </div>
        ))}
        <button type="submit" style={{ padding: '10px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}>
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fafbfc' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>S.No</th>
              {ITEM_MASTER_FIELDS.map((field) => (
                <th key={field.key} style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>{field.label}</th>
              ))}
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id}>
                <td style={{ border: '1px solid #eee', padding: 8 }}>{idx + 1}</td>
                {ITEM_MASTER_FIELDS.map((field) => (
                  <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{(rec as any)[field.key]}</td>
                ))}
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', marginRight: 8 }} onClick={() => handleEdit(idx)}>Edit</button>
                  <button onClick={() => handleDelete(idx)} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ItemMasterModule;
