feat(dashboard): dashboard pemantauan Serah Terima, Serial Number, Laporan, Stok Stiker, dan Postel
feat(dashboard): filter relasi dicari di server, widget dibatasi semafor, grup di luar layar tidak dimuat, warna delta menurut arah baik
chore(deploy): DB_POOL_SIZE dapat diatur lewat .env (compose.yml meneruskannya ke qc-app)
feat(dashboard): kueri widget dibatasi 30 detik di database agar slot tak tertahan tanpa batas
chore(deploy): memori qc-db (batas kontainer, buffer pool InnoDB, cache Aria) dapat diatur per lingkungan lewat QC_DB_MEM_LIMIT, QC_DB_BUFFER_POOL, QC_DB_ARIA_CACHE; bawaan 512m, 256M, 32M
feat(dashboard): tautan publik dashboard dengan cakupan terisolasi dan filter penonton
feat(dashboard): masa berlaku tautan dapat berupa tanggal tertentu (berlaku sampai akhir hari WIB), batas 50 tautan aktif dijaga atomik
feat(dashboard): halaman View per tautan publik dengan cakupan bernama, data kunjungan (jumlah, waktu, negara, perangkat, awalan IP), dan log aktivitas termasuk kedaluwarsa
fix(dashboard): halaman publik tanpa jumlah total daftar dan tanpa id internal pada kunci irisan dan seri
fix(dashboard): penyegaran halaman publik lewat POST sehingga tab terbuka tidak menambah kunjungan; kunjungan dicatat di latar dengan pra-cek dedup
fix(dashboard): log aktivitas tautan terbitan laporan memakai gerbang baca yang sama dengan View tautan; nama BU/lokasi terhapus tetap tampil dengan penanda
fix(dashboard): pemotongan IP kunjungan menolak IPv6 cacat dan ber-zona
perf(dashboard): indeks (expires_at, revoked_at) untuk penyapu kedaluwarsa tautan (migrasi 0037)
