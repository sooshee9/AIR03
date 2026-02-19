#!/usr/bin/env node
/**
 * scripts/normalize_psir_vsir.js
 *
 * Safe migration tool to normalize `poQty`/`okQty` fields in PSIR and VSIR documents.
 * - Dry-run by default (no writes). Use `--apply` to commit changes.
 * - Requires a Firebase service account JSON path via env `FIREBASE_SERVICE_ACCOUNT`.
 * - Usage:
 *    FIREBASE_SERVICE_ACCOUNT=./serviceAccount.json node scripts/normalize_psir_vsir.js --uid=USER_ID [--apply]
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function parseArgs() {
  const out = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    }
  });
  return out;
}

const args = parseArgs();
const uid = args.uid;
const apply = !!args.apply;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT env var is required (path to serviceAccount json)');
  process.exit(1);
}

if (!fs.existsSync(serviceAccountPath)) {
  console.error('Service account file not found at', serviceAccountPath);
  process.exit(1);
}

if (!uid) {
  console.error('Missing --uid=<USER_ID> argument. This script operates on a single user for safety.');
  process.exit(1);
}

const serviceAccount = require(path.resolve(serviceAccountPath));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const normalizeQty = (val) => {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return Math.abs(n);
};

const normalizeDocData = (data) => {
  if (!data || typeof data !== 'object') return null;
  const updates = {};

  if ('poQty' in data) {
    const pq = normalizeQty(data.poQty);
    if (pq === undefined) updates['poQty'] = admin.firestore.FieldValue.delete();
    else updates['poQty'] = pq;
  }

  if ('okQty' in data) {
    // remove okQty
    updates['okQty'] = admin.firestore.FieldValue.delete();
  }

  if (Array.isArray(data.items)) {
    const newItems = data.items.map(it => {
      if (!it || typeof it !== 'object') return it;
      const copy = { ...it };
      if ('poQty' in copy) {
        const pq = normalizeQty(copy.poQty);
        if (pq === undefined) delete copy.poQty; else copy.poQty = pq;
      }
      if ('okQty' in copy) delete copy.okQty;
      return copy;
    });
    updates['items'] = newItems;
  }

  return Object.keys(updates).length ? updates : null;
};

async function processPSIRs() {
  console.log('Scanning PSIRs for user:', uid);
  const col = db.collection('psirs').where('userId', '==', uid);
  const snap = await col.get();
  console.log('Found PSIR docs:', snap.size);
  let changed = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates = normalizeDocData(data);
    if (!updates) continue;
    console.log('Will update psirs/', doc.id, 'changes:', updates);
    changed++;
    if (apply) {
      batch.update(doc.ref, updates);
      ops++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
  }
  if (apply && ops > 0) await batch.commit();
  return changed;
}

async function processVSIRs() {
  console.log('Scanning VSIRs under users/', uid, '/vsirRecords');
  const col = db.collection('users').doc(uid).collection('vsirRecords');
  const snap = await col.get();
  console.log('Found VSIR docs:', snap.size);
  let changed = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates = normalizeDocData(data);
    if (!updates) continue;
    console.log('Will update users/', uid, '/vsirRecords/', doc.id, 'changes:', updates);
    changed++;
    if (apply) {
      batch.update(doc.ref, updates);
      ops++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
  }
  if (apply && ops > 0) await batch.commit();
  return changed;
}

(async () => {
  try {
    console.log('Dry-run mode:', !apply);
    const psirChanged = await processPSIRs();
    const vsirChanged = await processVSIRs();
    console.log(`Summary for user ${uid}: PSIRs to change=${psirChanged}, VSIRs to change=${vsirChanged}`);
    if (!apply) console.log('No writes performed — rerun with --apply to commit changes.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(2);
  }
})();
