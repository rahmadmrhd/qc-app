import type { VitePWAOptions } from 'vite-plugin-pwa';
import { THEME_COLORS } from '../../modules/theme/theme.ts';
import { SERVER_PATH_DENYLIST } from './server-paths.ts';

// Impor relatif berekstensi (bukan alias `@/`): berkas ini juga dimuat `vite.config.ts` oleh pemuat konfigurasi Vite.
export { SERVER_PATH_DENYLIST };

/**
 * Ambang ukuran berkas yang ikut pra-cache (byte, tidak terkompres). Berkas di atasnya (potongan berat seperti
 * halaman QR dengan `pdf-lib`) tidak dipra-cache dan dicache saat pertama dipakai (`CacheFirst` di bawah, FR-P9).
 * Nilai diverifikasi dengan build nyata; `scripts/verify-dist.ts` menjaga total pra-cache <= 5 MB (NFR-P2).
 */
export const PRECACHE_MAX_FILE_BYTES = 1_000_000;

/**
 * Konfigurasi `vite-plugin-pwa` (Workbox `generateSW`) di satu tempat.
 *
 * Titik perluasan: skrip service worker tambahan (mis. penanganan pesan atau fitur Fase 2) ditambahkan lewat
 * `workbox.importScripts` (berkas statis di `web/public/`), BUKAN dengan beralih ke `injectManifest`. Dipakai oleh
 * `push-sw.js` (handler push dan klik notifikasi Serah Terima); berkas itu tidak dipra-cache (`globIgnores`) agar
 * selalu diambil ulang saat peramban memeriksa pembaruan service worker.
 *
 * Aturan keras: service worker TIDAK boleh men-cache atau menjawab `/api`, `/auth`, `/sync`, dan tidak boleh
 * menyimpan jawaban API atau isi berkas pengguna di Cache Storage (FR-P8, NFR-P3). Karena itu `runtimeCaching`
 * hanya berisi aset berhash same-origin di `/assets/`.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  // Versi baru tidak mengambil alih halaman sebelum pengguna menyetujui (FR-P12): `skipWaiting` hanya lewat pesan.
  registerType: 'prompt',
  // Pendaftaran dikerjakan `app/pwa/update.ts` (Task 7), bukan skrip yang disisipkan plugin.
  injectRegister: false,
  manifest: {
    name: 'QC App',
    short_name: 'QC',
    lang: 'id',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLORS.light,
    background_color: THEME_COLORS.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
    globIgnores: ['push-sw.js'],
    importScripts: ['push-sw.js'],
    maximumFileSizeToCacheInBytes: PRECACHE_MAX_FILE_BYTES,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: SERVER_PATH_DENYLIST,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        // Potongan berhash yang tidak dipra-cache (terlalu besar, mis. halaman QR): cache saat pertama dipakai.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: {
          cacheName: 'qc-assets',
          expiration: { maxEntries: 30 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
  devOptions: { enabled: false },
  // Potongan di atas PRECACHE_MAX_FILE_BYTES memang sengaja tidak dipra-cache (FR-P9): cukup peringatan di log build,
  // bukan galat (bawaan plugin 2.x melempar galat).
  showMaximumFileSizeToCacheInBytesWarning: true,
};
