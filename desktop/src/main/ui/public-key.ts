// Kunci publik Ed25519 (PEM SPKI) untuk memverifikasi manifest UI bertanda tangan (spek §3.4, §15 butir 12).
// Kunci privat hanya di CI/pemilik; di sini hanya kunci publik.
//
// Kunci DISUNTIKKAN saat build desktop dari env `UI_PUBLIC_KEY_PEM` (`scripts/build.ts`, lewat `define` Bun.build),
// bukan ditulis di source: rotasi kunci tak butuh perubahan kode dan commit (keputusan pemilik 2026-11-16, spek §3.4).
// Nilai itu ikut masuk ke paket aplikasi yang ditandatangani, jadi tetap menjadi jangkar kepercayaan yang tak dapat
// diganti server atau lingkungan runtime. Tanpa suntikan (build dev, tes, `pack` tanpa env) nilainya `null`:
// `checkForUpdate` SELALU mengembalikan `{ status: 'none' }` (pembaruan UI nonaktif, aplikasi memakai UI dasar yang
// terkemas). Build rilis (`dist`) menolak berjalan tanpa kunci. Langkah pemilik: docs/desktop-ui-signing.md.

declare const __UI_PUBLIC_KEY_PEM__: string | null | undefined;

export const UI_PUBLIC_KEY_PEM: string | null =
  typeof __UI_PUBLIC_KEY_PEM__ === 'string' && __UI_PUBLIC_KEY_PEM__.length > 0
    ? __UI_PUBLIC_KEY_PEM__
    : null;
