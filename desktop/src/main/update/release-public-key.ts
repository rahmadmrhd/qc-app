// Kunci publik Ed25519 (PEM SPKI) untuk memverifikasi manifest rilis aplikasi (`release-<versi>.json`; spek desktop 5.3).
// TERPISAH dari kunci manifest UI (`ui/public-key.ts`) agar bocornya salah satu tak membuka yang lain.
//
// DISUNTIKKAN saat build desktop dari env `DESKTOP_RELEASE_PUBLIC_KEY_PEM` (`scripts/build.ts`, lewat `define`), bukan
// ditulis di source. Tanpa suntikan (build dev, tes, `pack` tanpa env) nilainya `null`: pembaruan aplikasi NONAKTIF.
// Build rilis (`dist`) menolak berjalan tanpa kunci. Langkah pemilik: docs/desktop-release-signing.md.

declare const __RELEASE_PUBLIC_KEY_PEM__: string | null | undefined;

export const RELEASE_PUBLIC_KEY_PEM: string | null =
  typeof __RELEASE_PUBLIC_KEY_PEM__ === 'string' && __RELEASE_PUBLIC_KEY_PEM__.length > 0
    ? __RELEASE_PUBLIC_KEY_PEM__
    : null;
