// Pemeriksa "UI benar-benar tampil" (R2-I2). `did-finish-load` hanya berarti `index.html` terkirim;
// bundel bertanda tangan yang rusak secara logika (galat JS saat boot) tetap lolos dan layarnya
// kosong. Setelah halaman dimuat, proses utama menanyai halaman berkala (tanpa sinyal dari renderer
// dan tanpa mengubah kontrak jembatan) apakah elemen akar web sudah terisi: terisi = `onOk`,
// tidak terisi sampai batas waktu = `onFailed` (rantai pemulihan: dua kali gagal -> previous ->
// dasar). Logika waktu murni (tanpa Electron) agar dapat diuji dengan timer palsu.

/**
 * Batas tunggu akar UI terisi. Harus lebih besar dari batas boot web (`GET /api/v1/me` 8 dtk di desktop,
 * `web/src/app/boot.ts`) agar server yang menjatuhkan paket tidak terbaca sebagai bundel UI rusak.
 */
export const RENDER_PROBE_TIMEOUT_MS = 15_000;

export interface RenderProbeDeps {
  /** `true` bila akar UI sudah terisi; melempar (mis. konteks halaman hilang) dihitung `false`. */
  check(): Promise<boolean>;
  onOk(): void;
  onFailed(): void;
  intervalMs: number;
  timeoutMs: number;
}

export interface RenderProbe {
  /** Mulai (atau mulai ulang) pemeriksaan untuk halaman yang baru selesai dimuat. */
  start(): void;
  /** Hentikan tanpa memanggil apa pun (navigasi baru, jendela ditutup). */
  cancel(): void;
}

export function createRenderProbe(deps: RenderProbeDeps): RenderProbe {
  // Nomor generasi: hasil pemeriksaan dari generasi lama (sudah dibatalkan/diganti) diabaikan.
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const tick = async (mine: number, startedAt: number): Promise<void> => {
    timer = null;
    let filled = false;
    try {
      filled = await deps.check();
    } catch {
      filled = false;
    }
    if (mine !== generation) return;
    if (filled) {
      deps.onOk();
      return;
    }
    if (Date.now() - startedAt >= deps.timeoutMs) {
      deps.onFailed();
      return;
    }
    timer = setTimeout(() => void tick(mine, startedAt), deps.intervalMs);
  };

  return {
    start() {
      clear();
      generation += 1;
      void tick(generation, Date.now());
    },
    cancel() {
      clear();
      generation += 1;
    },
  };
}
