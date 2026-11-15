import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { listStaleDrafts } from './repo';
import { isPartialName, isStagedName } from './store';

/**
 * Penyapu foto bukti `draft` yang tidak pernah disimpan (rancangan 2026-11-16 §6.5): baris dan berkas sementaranya
 * dibuang bila terakhir berubah > `draftSweepDays` hari lalu. Foto `queued`/`processing`/`failed`/`done` tidak pernah
 * disapu (kueri hanya memilih `draft`, dan penghapusan sendiri bersyarat `state = 'draft'` agar foto yang baru saja
 * diklaim Simpan di antara pemilihan dan penghapusan tak ikut hilang). Berkas dibuang HANYA bila barisnya benar-benar
 * terhapus oleh sapuan ini. Mengembalikan jumlah foto yang disapu. Dipanggil penjadwal jam-an.
 */
const SWEEP_BATCH = 200;
const DAY_MS = 86_400_000;

export async function sweepProofDrafts(env: Env): Promise<number> {
  const store = env.PROOF_STORE;
  const cutoff = new Date(nowOf(env) - SERIAL_PROOF_LIMITS.draftSweepDays * DAY_MS).toISOString();
  let swept = 0;
  // Batas putaran: paling banyak 10 halaman per jam (2.000 foto); sisanya disapu jam berikutnya.
  for (let page = 0; page < 10; page++) {
    const stale = await listStaleDrafts(env.DB, cutoff, SWEEP_BATCH);
    if (stale.length === 0) break;
    let removedInPage = 0;
    for (const draft of stale) {
      const result = await env.DB.prepare(
        "DELETE FROM serial_proof_photos WHERE id = ? AND state = 'draft'",
      )
        .bind(draft.id)
        .run();
      if ((result.meta?.changes ?? 0) === 0) continue;
      removedInPage++;
      swept++;
      if (store && draft.stagedName !== '') {
        await store.remove(draft.stagedName).catch((error) => {
          console.error(
            `penyapu foto bukti: berkas ${draft.stagedName} gagal dibuang: ${String(error)}`,
          );
        });
      }
    }
    // Tak ada yang terhapus pada halaman ini (semua keburu diklaim): hentikan agar tak berputar pada baris yang sama.
    if (removedInPage === 0 || stale.length < SWEEP_BATCH) break;
  }
  return swept;
}

/** Berkas sementara tak dirujuk apa pun baru dibuang bila lebih tua dari ini (melindungi berkas yang baru ditulis). */
export const ORPHAN_MIN_AGE_MS = 24 * 3_600_000;
/** Sisa `.partial` (penulisan atomik terputus) dibuang bila lebih tua dari ini, apa pun isi basis data. */
export const PARTIAL_MIN_AGE_MS = 3_600_000;

/** Nama berkas sementara yang masih dirujuk: `staged_name` baris mana pun dan `state.stamped` job aktif. */
async function referencedNames(env: Env): Promise<Set<string>> {
  const names = new Set<string>();
  const photos = await env.DB.prepare(
    "SELECT staged_name FROM serial_proof_photos WHERE staged_name <> ''",
  ).all<{ staged_name: string }>();
  for (const row of photos.results) names.add(row.staged_name);
  const jobs = await env.DB.prepare(
    "SELECT state FROM jobs WHERE kind = 'serial_proof' AND status IN ('queued', 'running') AND state <> ''",
  ).all<{ state: string }>();
  for (const row of jobs.results) {
    try {
      const stamped = (JSON.parse(row.state) as { stamped?: unknown } | null)?.stamped;
      if (typeof stamped === 'string') names.add(stamped);
    } catch {
      // state rusak: tak merujuk apa pun
    }
  }
  return names;
}

/**
 * Penyapu berkas yatim di `PROOF_STAGING_DIR` (rancangan 2026-11-16 §6.5; dipanggil penjadwal jam-an): berkas berpola UUID
 * berumur > 24 jam (waktu ubah) yang tak dicocokkan `staged_name` baris mana pun dan tak dirujuk `state.stamped` job aktif
 * (sisa proses mati: antara tulis berkas dan sisip baris, cap yang statenya tak sempat tersimpan, gagal hapus), dan sisa
 * `.partial` > 1 jam. Nama lain di folder tak disentuh. Foto `failed` tetap merujuk berkas aslinya (retensinya keputusan
 * terpisah). Mengembalikan jumlah berkas yang dibuang.
 */
export async function sweepOrphanProofFiles(env: Env): Promise<number> {
  const store = env.PROOF_STORE;
  if (!store) return 0;
  const now = nowOf(env);
  const files = await store.list();
  const candidates = files.filter((file) =>
    isPartialName(file.name)
      ? now - file.mtimeMs > PARTIAL_MIN_AGE_MS
      : isStagedName(file.name) && now - file.mtimeMs > ORPHAN_MIN_AGE_MS,
  );
  if (candidates.length === 0) return 0;
  // Dibaca SESUDAH daftar berkas: baris yang baru disisip untuk berkas yang baru ditulis tetap terlihat.
  const referenced = await referencedNames(env);
  let removed = 0;
  for (const file of candidates) {
    if (!isPartialName(file.name) && referenced.has(file.name)) continue;
    await store.removeOrphan(file.name).catch((error) => {
      console.error(`penyapu berkas yatim: ${file.name} gagal dibuang: ${String(error)}`);
    });
    removed++;
  }
  return removed;
}
