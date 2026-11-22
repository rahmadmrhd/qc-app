interface Place {
  pathname: string;
  search?: unknown;
}

/** Lokasi sama (jalur dan search): bukan meninggalkan halaman. */
export function isSameLocation(current: Place, next: Place): boolean {
  return (
    current.pathname === next.pathname &&
    JSON.stringify(current.search ?? {}) === JSON.stringify(next.search ?? {})
  );
}

/**
 * Pembungkus `shouldBlockFn` untuk penjaga keluar halaman (`useBlocker`). Pop riwayat yang tidak mengubah lokasi (menutup
 * overlay lewat back di ponsel: entri overlay ber-`__TSR_index` sama dengan halamannya) BUKAN meninggalkan halaman dan
 * tidak boleh dihalangi: blocker yang menahan pop berdelta 0 membuat pustaka memanggil `history.go(0)` = memuat ulang
 * halaman (review navigasi C1). Semua `useBlocker` wajib lewat pembungkus ini (dijaga `mobile-navigation-guard.test.ts`).
 */
export function leaveBlocker<A extends { current: Place; next: Place }>(
  shouldBlock: (args: A) => boolean,
): (args: A) => boolean {
  return (args) => (isSameLocation(args.current, args.next) ? false : shouldBlock(args));
}
