// Membuat seed.sql untuk D1 spike: skema + 2000 baris items.
import { writeFileSync } from 'node:fs';

const out: string[] = [
  'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, k TEXT, name TEXT, status TEXT, updated_at TEXT);',
  'CREATE INDEX IF NOT EXISTS items_k ON items(k);',
  'CREATE INDEX IF NOT EXISTS items_s ON items(status, updated_at);',
  'CREATE TABLE IF NOT EXISTS qlog (id TEXT, kind TEXT, attempts INTEGER, phase TEXT);',
  'CREATE TABLE IF NOT EXISTS ctr (k TEXT PRIMARY KEY, v INTEGER);',
  "INSERT OR IGNORE INTO ctr VALUES ('c', 0);",
];
for (let n = 0; n < 2000; n++) {
  const st = n % 3 ? 'active' : 'inactive';
  const ts = new Date(1.7e12 + n * 1000).toISOString();
  out.push(
    `INSERT OR IGNORE INTO items VALUES ('i${n}','item ${n} merk','Item ${n}','${st}','${ts}');`,
  );
}
writeFileSync(new URL('./seed.sql', import.meta.url), out.join('\n'));
