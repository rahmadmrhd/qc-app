import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { runJobStep } from '@server/modules/jobs/consumer';
import { delayLease, findActiveJob, listRunnableJobIds } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';

/** Selang polling runner (milidetik). */
export const JOB_RUNNER_INTERVAL_MS = 2_000;
/** Selang penjadwal pembersihan (satu jam). */
export const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
/** Jumlah id job yang dibaca per pemindaian. */
const SCAN_LIMIT = 20;

/**
 * Percobaan langkah yang sedang berjalan per job (hanya di memori proses ini): dipakai untuk membatasi
 * pengulangan galat sementara. Hilang saat proses restart, yang paling buruk memberi job satu putaran percobaan baru.
 */
const attemptsByJob = new Map<string, number>();

/**
 * Menjalankan job `queued`/`running` yang siap (lease habis atau tidak ada) berurutan menurut waktu dibuat dan
 * mengembalikan jumlah job yang dikerjakan (minimal satu langkah) oleh panggilan ini. Satu job dikerjakan
 * langkah demi langkah sampai selesai, gagal, atau ditunda karena galat sementara. Pemanggil serentak aman:
 * langkah dikuasai atomik (`claimStep`: `UPDATE ... WHERE ... lease_until <= ?` dan memeriksa baris yang
 * berubah), jadi job yang sama tidak pernah dijalankan dua kali; job yang dipegang pemanggil lain dilewati.
 */
export async function runPendingJobs(env: Env): Promise<number> {
  const worked = new Set<string>();
  const skipped = new Set<string>();
  for (;;) {
    const ids = await listRunnableJobIds(env, nowOf(env), SCAN_LIMIT);
    const id = ids.find((candidate) => !skipped.has(candidate));
    if (id === undefined) return worked.size;
    const attempt = (attemptsByJob.get(id) ?? 0) + 1;
    const result = await runJobStep(env, id, attempt);
    if (result.kind === 'skipped') {
      skipped.add(id);
      continue;
    }
    worked.add(id);
    if (result.kind === 'retry') {
      attemptsByJob.set(id, attempt);
      await delayLease(env, id, nowOf(env) + result.delaySeconds * 1000);
    } else {
      attemptsByJob.delete(id);
    }
  }
}

/**
 * Runner latar: memanggil `runPendingJobs` tiap `intervalMs` (bawaan 2 dtk), satu putaran pada satu waktu
 * (putaran berikutnya dijadwalkan SETELAH putaran sebelumnya selesai, jadi satu job pada satu waktu). Galat
 * putaran dicatat dan tidak menghentikan runner. Mengembalikan fungsi penghenti.
 */
export function startJobRunner(env: Env, options: { intervalMs?: number } = {}): () => void {
  const intervalMs = options.intervalMs ?? JOB_RUNNER_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await runPendingJobs(env);
    } catch (error) {
      console.error(`runner job: putaran gagal: ${String(error)}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * Menjadwalkan pembersihan: menyisipkan job `cleanup_qr` kecuali masih ada yang aktif (tidak menumpuk).
 * Mengembalikan id job baru, atau `null` bila tidak dibuat. Hanya menjadwalkan; pekerjaannya oleh runner.
 */
export async function scheduleCleanupJob(env: Env): Promise<string | null> {
  if (await findActiveJob(env, 'cleanup_qr')) return null;
  return enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
}

/**
 * Penjadwal: `scheduleCleanupJob` sekali saat mulai lalu tiap jam (`intervalMs`). Kerangka yang sama dipakai
 * untuk pekerjaan berkala lain (mis. dump malam). Mengembalikan fungsi penghenti.
 */
export function startScheduler(env: Env, options: { intervalMs?: number } = {}): () => void {
  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await scheduleCleanupJob(env);
    } catch (error) {
      console.error(`penjadwal: gagal menjadwalkan cleanup_qr: ${String(error)}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
