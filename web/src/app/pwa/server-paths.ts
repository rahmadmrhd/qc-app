/**
 * Navigasi yang TIDAK boleh dijawab `index.html` oleh service worker (`navigateFallbackDenylist`, FR-P8). Workbox
 * mencocokkannya terhadap path + query. Berkas tanpa dependensi/DOM supaya tes lintas-paket
 * (`scripts/pwa-server-paths.test.ts`) dapat memuatnya.
 *
 * - `/api`, `/auth`, `/sync` dan turunannya = rute server (`server/src/http/static.ts` `isServerPath`; awalan yang
 *   hanya mirip seperti `/apiary` atau `/authors` adalah rute klien dan tetap dijawab cangkang).
 * - Berkas berekstensi (`/sw.js`, `/manifest.webmanifest`, `/icons/x.png`) bukan rute klien: server menjawabnya
 *   sendiri atau 404, tidak pernah `index.html`.
 */
export const SERVER_PATH_DENYLIST: RegExp[] = [
  /^\/api(?:[/?]|$)/,
  /^\/auth(?:[/?]|$)/,
  /^\/sync(?:[/?]|$)/,
  /\/[^/?]+\.[^/]+$/,
];
