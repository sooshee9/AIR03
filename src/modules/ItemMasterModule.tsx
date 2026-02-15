import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface ItemMasterRecord {
  itemName: string;
  itemCode: string;
}

const LOCAL_STORAGE_KEY = 'itemMasterData';

const ITEM_MASTER_FIELDS = [
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
];

const ItemMasterModule: React.FC = () => {
  // Initialize records from localStorage, like IndentModule
  const [records, setRecords] = useState<ItemMasterRecord[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });
  const [form, setForm] = useState<ItemMasterRecord>({
    itemName: '',
    itemCode: '',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  // Save records to localStorage whenever they change (preserve behaviour until migrated)
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  // Migrate existing localStorage item master entries into Firestore on sign-in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      if (uid) {
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
                    const col = collection(db, 'users', uid, 'itemMaster');
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editIdx !== null) {
      setRecords((prev) => prev.map((rec, idx) => idx === editIdx ? { ...form } : rec));
      setEditIdx(null);
    } else {
      setRecords((prev) => [
        ...prev,
        { ...form },
      ]);
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
  const handleDelete = (idx: number) => {
    setRecords(records => records.filter((_, i) => i !== idx));
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
        <button type="submit" style={{ padding: '10px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}>Add</button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fafbfc' }}>
          <thead>
            <tr>
              {ITEM_MASTER_FIELDS.map((field) => (
                <th key={field.key} style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>{field.label}</th>
              ))}
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Edit</th>
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={idx}>
                {ITEM_MASTER_FIELDS.map((field) => (
                  <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{(rec as any)[field.key]}</td>
                ))}
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEdit(idx)}>Edit</button>
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
