export {};

// Membuka terowongan SSH: 127.0.0.1:33063 lokal -> MariaDB dev di VPS (kontainer qc-dev-db).
// Jalankan: bun run db:tunnel (biarkan terbuka selama tes yang butuh database nyata berjalan).
const SSH_ALIAS = 'rhd_vps_ipv4';
const PORT = 33063;

const proc = Bun.spawn(
  [
    'ssh',
    '-N',
    '-L',
    `${PORT}:127.0.0.1:${PORT}`,
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    SSH_ALIAS,
  ],
  { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);

console.log(`Terowongan SSH ${SSH_ALIAS}: 127.0.0.1:${PORT} -> VPS (Ctrl+C untuk berhenti)`);

process.on('SIGINT', () => proc.kill());
process.on('SIGTERM', () => proc.kill());

const code = await proc.exited;
if (code !== 0 && code !== 130) {
  console.error(
    `ssh keluar dengan kode ${code}: terowongan gagal dibuka. Periksa alias SSH "${SSH_ALIAS}" dan apakah port ${PORT} lokal sudah terpakai.`,
  );
}
process.exit(code === 130 ? 0 : code);
