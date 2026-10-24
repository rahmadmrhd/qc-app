# Spike jembatan Apps Script (Task 0.2)

Dilaksanakan 2026-10-25. Proyek Apps Script BARU `qc-bridge-spike` (script id `11PQ4RO866dM3_puQjcNU3_dW0OWA9tiLCapfolGor9GulumclwYvPgm2`, akun clasp `qcspectrum123@gmail.com`), dibuat lewat `clasp create-script`, web app `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`. Deployment aplikasi lama (`gas/.clasp.json`, `gas/deployment.json`) tidak disentuh. Kode: `bridge/spike/Code.gs` (`doPost` mengembalikan `{ok,len,ts}` dan, bila `?respond=N`, pad `N` karakter untuk uji arah baca).

Pengukur: `worker/spike/bridge-roundtrip.ts` (Worker sementara, `fetch` dengan badan hasil penyambungan string, `redirect: 'follow'` atau `'manual'`).

## Batasan pengukuran (penting)

Worker spike `qc-app-spike-bridge` TIDAK bisa di-deploy ke Cloudflare: akun QC belum punya subdomain `workers.dev` (`wrangler deploy` dan `wrangler dev --remote` menolak: "You need to register a workers.dev subdomain"). Mendaftarkan subdomain adalah perubahan pengaturan akun sehingga tidak dilakukan agen. Pengukuran dijalankan di runtime Workers (workerd) lokal lewat `wrangler dev --local` dari mesin pengembang di Indonesia. Akibatnya:
- Semantik `fetch`/redirect = semantik runtime Workers (sama), tetapi
- Latensi mencakup jalur jaringan dari komputer ini ke Google, BUKAN dari tepi Cloudflare (biasanya lebih cepat dan lebih stabil); batas CPU/subrequest paket gratis tidak teruji di sini.
- Tidak ada Worker yang perlu dihapus (tidak pernah ter-deploy).

Langkah pemilik untuk pengukuran di tepi (opsional, ±5 menit): daftarkan subdomain workers.dev di https://dash.cloudflare.com/2256d27ce4dcdcb9ade777cc2650fd81/workers/onboarding, lalu `cd worker/spike && CLOUDFLARE_ACCOUNT_ID=2256d27ce4dcdcb9ade777cc2650fd81 bunx wrangler deploy`, panggil `https://qc-app-spike-bridge.<sub>.workers.dev/?u=<URL web app ter-encode>&bytes=552960&n=20`, lalu `wrangler delete`. Task 4.5 tetap perlu mengukur CPU di staging.

## Hasil

Web app anonim: `POST` tanpa cookie/autentikasi → 302 ke `https://script.googleusercontent.com/macros/echo?user_content_key=...`; mengikuti `GET` ke Location mengembalikan JSON jawaban (200).

Arah unggah (badan POST, karakter base64 acak, `redirect: 'follow'`, semuanya 200 dan `len` yang diterima jembatan = panjang yang dikirim):

| Badan | n | p50 | p95 | min–max |
|---|---|---|---|---|
| 10 KB | 25 | 977 ms | 1093 ms | 878–1428 ms |
| 540 KB (552.960) | 5 | 1800 ms | 1988 ms | 1707–1988 ms |
| 1 MB | 5 | 3312 ms | 3659 ms | 2732–3659 ms |
| 2 MB | 2 | 4689 ms | 4766 ms | – |
| 5 MB | 1 | 9667 ms | – | – |
| 10 MB | 1 | 19162 ms | – | – |

Arah baca (jawaban besar, badan kecil), `n=2`: 540 KB ≈ 1,3–1,9 dtk; 1 MB ≈ 1,2–1,3 dtk; 5 MB ≈ 2,2 dtk (panjang jawaban diterima utuh: 553.009 / 1.048.625 / 5.242.929 karakter).

Mode `redirect: 'manual'` (n=2, 10 KB): status pertama 302, Location di `script.googleusercontent.com`, `fetch(Location)` (GET) mengembalikan 200 dan badan jawaban; ≈ 1,0 dtk.

Catatan: `curl -L -X POST` menghasilkan 411 karena curl mengirim ulang POST pada redirect; ini artefak curl, bukan perilaku `fetch` (yang mengubah ke GET sesuai spesifikasi).

## Keputusan

- **(a)** Ya. `fetch` Workers dengan `redirect: 'follow'` (bawaan) mengikuti 302 sebagai `GET` tanpa badan dan mengembalikan badan jawaban (`response.redirected === true`). Tidak perlu penanganan manual; `redirect: 'manual'` + `GET Location` juga bekerja sebagai cadangan. Task 3.2: anggap satu panggilan jembatan = 2 subrequest (POST + GET) dalam hitungan anggaran 50 sampai terbukti lain di staging.
- **(b)** Badan unggah 10 KB, 540 KB, 1 MB, 2 MB, 5 MB, dan 10 MB semuanya lolos; jawaban hingga 5 MB lolos. Batas praktis bukan ukuran melainkan waktu (±1,8 dtk per 540 KB, ±3,3 dtk per 1 MB, ±1,9 dtk per MB di atas itu). Rekomendasi: batas badan jembatan 1 MB (pagar `files.upload` ≤ 540 KB sudah di bawahnya).
- **(c)** Dari mesin ini: 10 KB p50 ≈ 1,0 dtk / p95 ≈ 1,1 dtk (n=25); 540 KB p50 ≈ 1,8 dtk / p95 ≈ 2,0 dtk; 1 MB p50 ≈ 3,3 dtk / p95 ≈ 3,7 dtk. Waktu tunggu tidak dihitung CPU Worker. Perlu diukur ulang dari tepi bila pemilik mendaftarkan subdomain (lihat di atas).
- **(d)** Pilih penyambungan string di Worker (tanpa `JSON.parse`/decode base64): amplop dibangun dengan penggabungan teks, 540 KB–1 MB terbukti lolos pada 1 salinan string. Unggahan langsung klien → jembatan dengan tiket TIDAK diperlukan. Syarat: CPU penyambungan di tepi harus dikonfirmasi pada Task 4.5 (operasi string linear, tidak diperkirakan material). Alternatif tiket hanya jika CPU edge > anggaran.
- **(e)** Ya. Web app yang di-deploy "Anyone, even anonymous" dapat dipanggil tanpa login Google (tanpa cookie/header autentikasi). Konsekuensi: titik akhir publik, sehingga HMAC + `ts` + allowlist + pembatas (Task 3.1) wajib. Catatan clasp: `clasp create-script` menimpa `appsscript.json` lokal dengan bawaan; blok `webapp` harus ditulis ulang sebelum `push` dan deployment dibuat SETELAH itu.

## Ruling

1. Dua kali push: deployment pertama dibuat sebelum `webapp` ada di manifest (berakses default); deployment yang dipakai uji adalah yang kedua. Deployment spike dibiarkan hidup (hanya memantulkan panjang badan) agar pemilik bisa mengulang uji di tepi; boleh di-undeploy/hapus proyeknya kapan saja.
2. Subdomain workers.dev tidak didaftarkan (perubahan pengaturan akun; di luar kewenangan).
