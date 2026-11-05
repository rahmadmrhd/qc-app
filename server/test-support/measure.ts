/**
 * CPU yang dipakai proses ini (user + system, `process.cpuUsage`) selama `fn`; waktu menunggu basis data lewat
 * jaringan (MariaDB di VPS lewat tunnel) tidak dihitung. Ukuran sebenarnya CPU edge: `scripts/load-cpu.ts`.
 */
export async function measureCpu<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const before = process.cpuUsage();
  const result = await fn();
  const used = process.cpuUsage(before);
  return { result, ms: (used.user + used.system) / 1000 };
}
