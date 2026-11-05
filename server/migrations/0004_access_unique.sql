-- Keunikan yang di Apps Script dijaga kode di dalam lock (cek lalu tulis). Di D1 tidak ada lock,
-- jadi dijaga indeks UNIK; pelanggaran dipetakan service menjadi CONFLICT.
CREATE UNIQUE INDEX roles_name_unique ON roles (lower(trim(name)));
CREATE UNIQUE INDEX locations_code_unique ON locations (code);
CREATE UNIQUE INDEX locations_name_unique ON locations (lower(name));
