import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { listStaleDrafts } from './repo';

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
