import { overlayDepth, runAfterOverlays } from './nav-stack';

/**
 * Membungkus `router.navigate`: navigasi yang terjadi saat entri overlay masih di puncak riwayat (filter dari lembar
 * pilihan, kolom cari saat mode pilih, dialog yang menutup sambil berpindah) menunggu overlay dilepas dulu. Tanpa ini
 * `replace` menimpa entri overlay beserta penandanya dan back kemudian mengurai perubahan (review navigasi I2).
 * Desktop tidak punya entri overlay, jadi perilakunya tak berubah.
 */
export function deferNavigateUnderOverlays<
  R extends { navigate: (options: never) => Promise<unknown> },
>(router: R): void {
  const original = router.navigate.bind(router) as (options: unknown) => Promise<unknown>;
  (router as { navigate: unknown }).navigate = (options: unknown) =>
    overlayDepth() > 0
      ? new Promise((resolve, reject) =>
          runAfterOverlays(() => original(options).then(resolve, reject)),
        )
      : original(options);
}
