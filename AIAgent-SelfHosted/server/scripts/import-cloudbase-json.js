'use strict';
process.env.SELF_HOSTED = 'true';

const fs = require('node:fs');
const path = require('node:path');
const { getDatabase, closeDatabase } = require('../lib/document-db');

function parseRows(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.data)) return parsed.data;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {}
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSON at line ${index + 1}`); }
  });
}

(async () => {
  const collectionName = String(process.argv[2] || '').trim();
  const fileName = String(process.argv[3] || '').trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(collectionName)) throw new Error('Usage: node server/scripts/import-cloudbase-json.js <collection> <file.json>');
  if (!fileName) throw new Error('JSON file path is required');
  const rows = parseRows(fs.readFileSync(path.resolve(fileName), 'utf8'));
  const collection = getDatabase().collection(collectionName);
  let imported = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = String(row._id || '').trim();
    if (!id) throw new Error(`Collection ${collectionName} contains a document without _id`);
    await collection.doc(id).set({ data: row });
    imported += 1;
  }
  console.log(JSON.stringify({ collection: collectionName, source: path.resolve(fileName), imported }, null, 2));
})().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; }).finally(() => closeDatabase().catch(() => {}));
