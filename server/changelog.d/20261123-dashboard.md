feat(dashboard): dashboard pemantauan Serah Terima, Serial Number, Laporan, Stok Stiker, dan Postel
feat(dashboard): filter relasi dicari di server, widget dibatasi semafor, grup di luar layar tidak dimuat, warna delta menurut arah baik
chore(deploy): DB_POOL_SIZE dapat diatur lewat .env (compose.yml meneruskannya ke qc-app)
feat(dashboard): kueri widget dibatasi 30 detik di database agar slot tak tertahan tanpa batas
chore(deploy): batas memori kontainer qc-db naik dari 384m ke 500m
