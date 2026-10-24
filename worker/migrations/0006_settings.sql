-- Konfigurasi aplikasi bernilai teks yang dulu berupa Script Property (mis. id folder Drive).
-- Bukan rahasia; rahasia tetap di Worker Secrets.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
