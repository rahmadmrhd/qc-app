// Pembanding LOKAL (bukan angka Cloudflare): waktu CPU skenario spike pada mesin ini, V8/Bun.
import { readFileSync } from 'node:fs';

const j = readFileSync(new URL('./payload-json.txt', import.meta.url), 'utf8');
const b = readFileSync(new URL('./payload-b64.txt', import.meta.url), 'utf8');
function bench(name: string, fn: () => unknown, n = 50) {
  for (let i = 0; i < 5; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  t.sort((x, y) => x - y);
  console.log(name, 'p50', t[Math.floor(n / 2)].toFixed(2), 'p99', t[n - 1].toFixed(2), 'ms');
}
bench('JSON.parse 700KB', () => JSON.parse(j));
bench('concat b64 540KB (no decode)', () => `{"p":"${b}"}`.length);
bench('atob 540KB', () => atob(b).length);
