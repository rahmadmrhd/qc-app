-- Hemat rows read D1 (dihitung dari baris yang DIPINDAI): pencarian `instr(items.alias_keys, ...)` memindai
-- seluruh `items` pada setiap simpan item/ganti nama merk, dan `COUNT(*) ... GROUP BY brand_id` juga.
--
-- 1. item_alias_keys: indeks ternormalisasi satu baris per kunci nama lain item. PRIMARY KEY = keunikan kunci
--    nama lain di seluruh item (dijaga basis data; sebelumnya hanya dicek aplikasi). Kunci yang sama dengan
--    items.key item lain tetap dicek aplikasi (`assertItemNamesFree`). `alias_keys` di `items` tetap ada
--    (pencarian substring daftar item, ekspor). WAJIB ditulis bersama `items` (insert/update item, impor).
CREATE TABLE item_alias_keys (
  key TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  item_id TEXT NOT NULL
) WITHOUT ROWID;
-- Isi dari data lama. Bila dua item ternyata memegang kunci yang sama (data lama tidak dijaga basis data),
-- salah satunya dipertahankan (INSERT OR IGNORE); `verify-import` melaporkan ketidakselarasan.
WITH RECURSIVE split(item_id, key, rest) AS (
  SELECT id, '', substr(alias_keys, 2) FROM items WHERE alias_keys <> ''
  UNION ALL
  SELECT item_id, substr(rest, 1, instr(rest, '|') - 1), substr(rest, instr(rest, '|') + 1)
  FROM split WHERE rest <> ''
)
INSERT OR IGNORE INTO item_alias_keys (key, item_id) SELECT key, item_id FROM split WHERE key <> '';

-- 2. brands.item_count: jumlah item (aktif dan nonaktif) per merk, dijaga setiap penulisan item
--    (insert item +1; ganti merk -1/+1). Item tidak pernah dihapus.
ALTER TABLE brands ADD COLUMN item_count INTEGER NOT NULL DEFAULT 0;
UPDATE brands SET item_count = (SELECT COUNT(*) FROM items WHERE items.brand_id = brands.id);
