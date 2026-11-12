// Kunci publik Ed25519 (PEM SPKI) untuk memverifikasi manifest UI bertanda tangan (spek §3.4, §15
// butir 12). Kunci privat hanya di CI/pemilik; di sini hanya kunci publik.
//
// SEMENTARA `null`: selama belum diisi, `checkForUpdate` SELALU mengembalikan `{ status: 'none' }`
// (pembaruan UI dinonaktifkan, aplikasi memakai UI dasar yang terkemas). Pemilik mengisinya
// mengikuti docs/desktop-ui-signing.md (dibuat pada Task H8). Jangan mengisi dengan kunci uji.

export const UI_PUBLIC_KEY_PEM: string | null = null;
