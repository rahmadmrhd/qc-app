// Penggerak probe HTTP (Task 0.3): memanggil /probe/<skenario>?reps=K berulang dan mencatat status + latensi.
// Pemakaian: bun run-probes.ts <baseUrl> <key>   (kunci dari --var KEY saat deploy)
const [base, key] = process.argv.slice(2);
if (!base || !key) throw new Error('pakai: bun run-probes.ts <baseUrl> <key>');

const N = Number(process.env.N ?? 30);
const ladder: [string, string][] = (
  process.env.LADDER ??
  'baseline;json-parse:reps=1;json-parse:reps=8;json-parse:reps=16;json-parse:reps=32;forward-b64:reps=1;forward-b64:reps=100;atob:reps=1;atob:reps=100;d1-batch:reps=1;burn:units=2;burn:units=5;burn:units=10;burn:units=20;burn:units=40;burn:units=100;burn:units=300'
)
  .split(';')
  .map((entry) => {
    const [kind, query = ''] = entry.split(':');
    return [kind, query] as [string, string];
  });
const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];

for (const [kind, query] of ladder) {
  const codes: Record<string, number> = {};
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    // DNS lokal bisa mengembalikan IP salah untuk *.workers.dev; IP edge diberikan lewat env EDGE_IP (dari DoH).
    const host = new URL(base).host;
    const args = [
      '-sS',
      '-m',
      '20',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '-H',
      `x-spike-key: ${key}`,
    ];
    if (process.env.EDGE_IP) args.push('--resolve', `${host}:443:${process.env.EDGE_IP}`);
    args.push(`${base}/probe/${kind}?${query}`);
    const out = Bun.spawnSync(['curl', ...args]);
    const status = out.stdout.toString() || 'net';
    times.push(performance.now() - start);
    codes[status] = (codes[status] ?? 0) + 1;
  }
  times.sort((x, y) => x - y);
  console.log(
    `${kind} ${query}`.padEnd(22),
    JSON.stringify(codes).padEnd(24),
    `klien p50 ${pct(times, 50).toFixed(0)} ms, p99 ${pct(times, 99).toFixed(0)} ms`,
  );
}
