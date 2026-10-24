// Membuat payload uji spike (tidak di-commit): JSON ~700 KB dan base64 ~540 KB.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const items: unknown[] = [];
let size = 0;
for (let i = 0; size < 700_000; i++) {
  const o = {
    id: `h${i}`,
    number: `ST-20261025-${String(i).padStart(3, '0')}`,
    status: 'working',
    note: 'x'.repeat(2000),
    checks: Array.from({ length: 20 }, (_, k) => ({ k, on: k % 2 === 0, by: 'a@b.c' })),
    comments: Array.from({ length: 5 }, (_, k) => ({ id: k, body: 'komentar '.repeat(20) })),
  };
  size += JSON.stringify(o).length + 1;
  items.push(o);
}
writeFileSync(new URL('./payload-json.txt', import.meta.url), JSON.stringify(items));
writeFileSync(
  new URL('./payload-b64.txt', import.meta.url),
  randomBytes(405_000).toString('base64'),
);
