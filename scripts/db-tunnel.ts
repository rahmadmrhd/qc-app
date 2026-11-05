export {};

// Membuka terowongan SSH: 127.0.0.1:33063 lokal -> MariaDB dev di VPS (kontainer qc-dev-db).
// Jalankan: bun run db:tunnel (biarkan terbuka selama dev atau tes yang butuh database nyata berjalan).
// Bila koneksi SSH terputus (jaringan/VPS memutus), terowongan dibuka ulang otomatis setelah jeda singkat.
const SSH_ALIAS = 'rhd_vps_ipv4';
const PORT = 33063;
const RETRY_DELAY_MS = 2000;

let stopping = false;
let current: ReturnType<typeof Bun.spawn> | undefined;

function stop() {
  stopping = true;
  current?.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(`Terowongan SSH ${SSH_ALIAS}: 127.0.0.1:${PORT} -> VPS (Ctrl+C untuk berhenti)`);

let failures = 0;
while (!stopping) {
  const startedAt = Date.now();
  current = Bun.spawn(
    [
      'ssh',
      '-N',
      '-L',
      `${PORT}:127.0.0.1:${PORT}`,
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'TCPKeepAlive=yes',
      SSH_ALIAS,
    ],
    { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  );
  const code = await current.exited;
  if (stopping || code === 130) break;
  // Gagal sejak awal berulang kali = bukan putus sesaat (alias salah, port lokal terpakai): berhenti.
  failures = Date.now() - startedAt < 5000 ? failures + 1 : 0;
  if (failures >= 3) {
    console.error(
      `ssh keluar dengan kode ${code} berulang: terowongan gagal dibuka. Periksa alias SSH "${SSH_ALIAS}" dan apakah port ${PORT} lokal sudah terpakai.`,
    );
    process.exit(code || 1);
  }
  console.error(
    `ssh keluar (kode ${code}); membuka ulang terowongan dalam ${RETRY_DELAY_MS / 1000} dtk ...`,
  );
  await Bun.sleep(RETRY_DELAY_MS);
}
process.exit(0);
