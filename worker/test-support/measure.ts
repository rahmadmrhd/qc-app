/** Proksi kasar CPU: selisih waktu dinding proses sinkron/async (ukuran sebenarnya: Task 4.5). */
export async function measureCpu<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - started };
}
