feat(dashboard): dashboard pemantauan Serah Terima, Serial Number, Laporan, Stok Stiker, dan Postel
feat(dashboard): filter relasi dicari di server, widget dibatasi semafor, grup di luar layar tidak dimuat, warna delta menurut arah baik
chore(deploy): DB_POOL_SIZE dapat diatur lewat .env (compose.yml meneruskannya ke qc-app)
feat(dashboard): kueri widget dibatasi 30 detik di database agar slot tak tertahan tanpa batas
chore(deploy): memori qc-db (batas kontainer, buffer pool InnoDB, cache Aria) dapat diatur per lingkungan lewat QC_DB_MEM_LIMIT, QC_DB_BUFFER_POOL, QC_DB_ARIA_CACHE; bawaan 512m, 256M, 32M
