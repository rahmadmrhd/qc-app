-- Backend push notifikasi Serah Terima (spek 2026-11-12-notifikasi-serah-terima-design.md §5.2): langganan Web Push dan
-- preferensi push per pengguna. (`notifications.push_state` sudah ada di 0013.)
--
-- EXPAND-ONLY, kompatibel mundur: hanya tabel baru dan satu indeks tambahan; image sebelumnya tak mengenalnya dan tetap berjalan di atas skema ini.
-- Idempoten (CREATE TABLE IF NOT EXISTS). Tanpa kunci asing (penerima dikunci email ternormalisasi).

-- Satu langganan melekat pada peramban, bukan akun: kunci (endpoint_hash, recipient) mengizinkan beberapa pengguna
-- di perangkat yang sama memiliki baris masing-masing (logout tidak menghentikan push). `endpoint_hash` = SHA-256
-- heksa endpoint. `fail_count` = kegagalan kirim berturut-turut (0 saat sukses); `last_error` hanya teks pendek
-- generik (tanpa endpoint atau isi respons).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint_hash CHAR(64) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(200) NOT NULL DEFAULT '',
  auth VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  last_ok_at VARCHAR(30) NOT NULL DEFAULT '',
  last_error_at VARCHAR(30) NOT NULL DEFAULT '',
  last_error VARCHAR(100) NOT NULL DEFAULT '',
  fail_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint_hash, recipient),
  KEY push_subscriptions_recipient (recipient)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Preferensi per pengguna: `push_enabled` bawaan 1 (aktif bawaan, spek §5.2); `permission` = izin peramban yang
-- dilaporkan klien ('granted' | 'denied' | 'default'), untuk status admin.
CREATE TABLE IF NOT EXISTS notification_prefs (
  recipient VARCHAR(255) NOT NULL,
  push_enabled TINYINT NOT NULL DEFAULT 1,
  permission VARCHAR(12) NOT NULL DEFAULT 'default',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (recipient)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Indeks pembersihan notifikasi lama (`purgeOldNotifications` menyaring `created_at` saja; indeks 0013 dimulai dari
-- `recipient`/`push_state`). Idempoten; menambah indeks pada tabel yang sudah ada kompatibel mundur.
CREATE INDEX IF NOT EXISTS notifications_created ON notifications (created_at);
