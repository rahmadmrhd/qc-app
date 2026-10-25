export {};

// `bun run dev`: Worker lokal (wrangler dev + D1 lokal, :8787) dan Vite (:3000, proxy /api /auth /sync ke Worker)
// bersamaan. Ctrl+C menghentikan keduanya. Pertama kali: `bun run db:seed`. Lihat docs/dev-worker.md.
const children = [
  Bun.spawn(['bun', 'run', 'dev:worker'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', '--cwd', 'web', 'dev'], { stdout: 'inherit', stderr: 'inherit' }),
];

function stop() {
  for (const child of children) child.kill();
}
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', stop);

// Salah satu berhenti (galat atau ditutup) -> hentikan yang lain.
await Promise.race(children.map((child) => child.exited));
stop();
process.exit(1);
