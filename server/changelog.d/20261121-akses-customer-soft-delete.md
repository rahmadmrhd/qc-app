feat(access): pengguna, role, lokasi, BU, dan customer punya rute get, ubah status massal, hapus lunak, dan pulihkan (id baru; rute hapus role lama kini hapus lunak)
feat(audit): entri log audit baru membawa target_id sehingga dapat menaut ke halaman entitasnya (targetRef pada access.audit.list)
change(access): pengguna dan role terhapus tidak memberi hak dan tidak menerima notifikasi; lokasi terhapus dibaca nonaktif; BU terhapus tetap memberi hak tetapi tidak ditawarkan di pilihan
