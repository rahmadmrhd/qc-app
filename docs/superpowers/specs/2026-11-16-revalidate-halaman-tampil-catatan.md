# Catatan: revalidate hanya halaman yang tampil (daftar berkursor)

Status: **ide ke depan, belum dikerjakan**. Dicatat 2026-11-16 atas permintaan pemilik produk.

## Latar belakang

Pada 2026-11-16 default TanStack Query (`web/src/app/query-client.ts`) diubah agar query aktif dimuat ulang tiap 30 detik
(`DEFAULT_REFETCH_INTERVAL_MS`), hanya saat tab terlihat (`refetchIntervalInBackground: false`), dan juga saat jendela
mendapat fokus (`refetchOnWindowFocus: true`, tetap menghormati `staleTime` 60 dtk). Tujuannya: data yang tampil terus
terbarui. Keputusan pemilik: selang 30 dtk sesuai; fokus jendela `true`.

## Masalah

Daftar yang memakai `useInfiniteQuery` dimuat ulang sebagai SATU unit: tiap tick, TanStack Query mengambil ulang
**semua halaman yang sudah dibuka**, berurutan, memakai cursor yang tersimpan. Pengguna yang sudah menggulir sampai
halaman ke-5 menghasilkan 5 permintaan per tick per daftar, padahal hanya sebagian halaman yang tampil di layar. Papan
Serah Terima paling terasa karena memiliki 4 kolom infinite (paling sedikit 4 permintaan per tick).

Beban saat ini dinilai ringan (halaman 20-50 baris, kebanyakan pengguna berhenti di 1-3 halaman, polling berhenti saat tab
tersembunyi), jadi **belum diperbaiki**.

## Keinginan pemilik

Saat revalidate, hanya halaman yang sedang tampil yang dimuat ulang (penentuan cursor halaman yang tampil). Halaman
sebelumnya dimuat ulang bila pengguna menggulir ke atas, dan halaman berikutnya bila menggulir ke bawah.

## Kenapa belum bisa dengan konfigurasi saja

- Infinite query tidak punya opsi memuat ulang per halaman.
- `maxPages` (jendela geser) mewajibkan `getPreviousPageParam` agar halaman yang terbuang dapat dimuat lagi. Semua daftar
  sekarang satu arah: hanya `getNextPageParam` dan `nextCursor`; server tidak punya cursor mundur.
- Pendekatan satu query per halaman berarti menulis ulang komponen daftar, dan cursor halaman berikutnya dapat bergeser
  bila isi halaman sebelumnya berubah.

## Arah perbaikan (saat dikerjakan)

1. Server: tambahkan cursor mundur (`prevCursor`) pada daftar berkursor, di kontrak `shared/contract.ts` dan modulnya.
   Daftar terdampak: item, serial, riwayat serial, kasus serial, papan Serah Terima (per kolom), Log Audit, riwayat stok
   stiker, pustaka gambar stiker (dialog berkas).
2. Web: pasang `getPreviousPageParam` + `maxPages` pada `infiniteQueryOptions` terkait, dan sentinel gulir ke atas
   (`web/src/components/file-dialog/use-infinite-sentinel.ts`, `web/src/modules/handover/lib/near-viewport.tsx` sudah
   memuat pola gulir ke bawah).
3. Pertimbangkan virtualisasi daftar (DOM hanya memuat baris yang tampil) sebagai satu paket dengan jendela geser.
4. Tes: konsistensi saat isi halaman berubah di antara dua revalidate (tanpa baris ganda atau terlewat).

## Langkah murah sebelum itu (bila beban terasa)

Naikkan selang khusus daftar infinite (mis. 60 dtk) lewat `refetchInterval` pada `infiniteQueryOptions` terkait, atau
matikan polling untuk daftar tertentu sambil mempertahankan refetch saat fokus.
