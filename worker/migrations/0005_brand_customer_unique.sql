-- Nama merk dan customer (kunci ternormalisasi) unik; dijaga indeks UNIK karena D1 tanpa lock.
DROP INDEX brands_key;
CREATE UNIQUE INDEX brands_key ON brands (key);
DROP INDEX customers_key;
CREATE UNIQUE INDEX customers_key ON customers (key);
