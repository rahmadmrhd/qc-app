// Penjaga muat ulang saat inject berjalan (R2-I1). Pencatatan serial ke pending hanya dilakukan
// renderer setelah hasil inject tiba; bila jendela dimuat ulang/berpindah halaman di tengah inject,
// hasilnya jatuh ke renderer yang sudah hilang, serial tak tercatat, dan Auto Inject dapat
// meng-inject perangkat yang sama dua kali. Karena itu: (a) pemuatan URL (tautan `qc://` kedua,
// pemulihan UI) ditunda sampai inject selesai, (b) pintasan muat ulang (F5, Ctrl+R) diblokir
// selama inject. Logika murni tanpa Electron agar dapat diuji.

export interface ReloadGateDeps {
  isInjecting(): boolean;
  /** Memuat URL di jendela utama (`webContents.loadURL`). */
  load(url: string): void;
  /**
   * Masa tenang setelah inject berakhir sebelum URL tertunda dimuat: jawaban `invoke` inject dan
   * panggilan `pending.add` renderer sesudahnya masih perlu tiba sebelum halaman diganti.
   */
  settleMs: number;
}

export interface ReloadGate {
  /** Muat sekarang (`now`) atau tunda sampai inject selesai (`deferred`). Yang terakhir menang. */
  load(url: string): 'now' | 'deferred';
  /** Dipanggil saat tak ada lagi inject yang berjalan. */
  notifyIdle(): void;
  /** Pintasan muat ulang harus diblokir sekarang? */
  isReloadBlocked(): boolean;
}

export function createReloadGate(deps: ReloadGateDeps): ReloadGate {
  let pendingUrl: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  function notifyIdle(): void {
    if (pendingUrl === null) return;
    clear();
    timer = setTimeout(() => {
      timer = null;
      if (pendingUrl === null) return;
      // Inject masih/lagi berjalan (mis. Multi dihentikan saat sesi SSH belum selesai menutup): jangan
      // tertinggal selamanya, jadwalkan ulang masa tenang sampai benar-benar idle.
      if (deps.isInjecting()) {
        notifyIdle();
        return;
      }
      const url = pendingUrl;
      pendingUrl = null;
      deps.load(url);
    }, deps.settleMs);
  }

  return {
    load(url) {
      if (deps.isInjecting()) {
        pendingUrl = url;
        return 'deferred';
      }
      // Permintaan baru menggantikan yang tertunda (dan membatalkan masa tenangnya).
      pendingUrl = null;
      clear();
      deps.load(url);
      return 'now';
    },
    notifyIdle,
    isReloadBlocked: () => deps.isInjecting(),
  };
}

export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Pintasan muat ulang yang diblokir selama inject: F5 (dengan modifier apa pun) dan Ctrl/Cmd+R
 * (juga dengan Shift). Dipakai di `before-input-event`; menu bawaan Electron dibuang di `window.ts` (`removeMenu`), jadi tak ada jalur muat ulang lewat menu.
 */
export function shouldBlockReloadKey(input: KeyInput, injecting: boolean): boolean {
  if (!injecting || input.type !== 'keyDown') return false;
  if (input.key === 'F5') return true;
  return (input.control || input.meta) && input.key.toLowerCase() === 'r';
}
