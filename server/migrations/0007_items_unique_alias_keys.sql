-- Kunci item (merk + tipe ternormalisasi) unik; dijaga indeks UNIK karena D1 tanpa lock.
DROP INDEX items_key;
CREATE UNIQUE INDEX items_key ON items (key);
-- alias_keys: kunci ternormalisasi semua nama lain item dalam bentuk '|kunci1|kunci2|' (kosong bila tanpa
-- nama lain). Memungkinkan cek bentrok nama lain dan pencarian lewat SQL tanpa mem-parse JSON `aliases`.
-- WAJIB diisi setiap penulisan item (service, sinkron) dan oleh skrip impor.
ALTER TABLE items ADD COLUMN alias_keys TEXT NOT NULL DEFAULT '';
