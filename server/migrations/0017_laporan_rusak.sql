-- Serial Number: alur laporan rusak yang dipangkas (rancangan 2026-11-14). Idempoten: kolom/indeks memakai IF NOT EXISTS
-- dan UPDATE data aman diulang (hasil identik).
--
-- PENGECUALIAN expand -> contract (keputusan pemilik 2026-11-14, spek 2026-11-14-serial-laporan-rusak-design §2 butir 2):
-- nilai status lama dipetakan LANGSUNG pada rilis yang sama dengan kodenya (pendekatan A). Serial Number 5b baru ada di
-- staging dengan data uji, jadi image 5b yang dikembalikan akan membaca status baru ('reported', 'diagnosis') sebagai
-- tak dikenal; bila deploy gagal, perbaiki ke depan, jangan rollback ke image 5b (lihat docs/ci-cd.md). Kejadian lama
-- (`serial_events`) tidak diubah sama sekali.

-- (1) 'failed' dan 'qc_repair' dilebur menjadi 'reported' (Dilaporkan). Status lain tetap.
UPDATE serials SET status = 'reported' WHERE status IN ('failed', 'qc_repair');

-- (2) Sisa kirim antar lokasi (status Lolos yang masih berkustodi 'transit'): pengiriman antar lokasi dihapus, jadi
-- serial dianggap sudah diterima di lokasi tujuan. `location_id` diisi lebih dulu (MariaDB mengevaluasi SET dari kiri ke
-- kanan) sebelum kolom transit dikosongkan.
UPDATE serials
SET location_id = CASE WHEN transit_to_location_id <> '' THEN transit_to_location_id ELSE location_id END,
    custody = 'qc',
    transit_from_location_id = '',
    transit_to_location_id = '',
    transit_on = ''
WHERE status = 'good' AND custody = 'transit';

-- (3) Lokasi QC asal laporan: diisi saat Kirim ke servis (lokasi unit saat itu) dan dipulihkan saat Terima (QC).
ALTER TABLE serial_cases ADD COLUMN IF NOT EXISTS origin_location_id VARCHAR(100) NOT NULL DEFAULT '';

-- (4) Laporan lama yang sudah pernah dikirim: asal = lokasi asal kejadian kirim TERAWAL laporan itu. Laporan yang belum
-- pernah dikirim tetap kosong (diisi saat kirim).
UPDATE serial_cases c
SET c.origin_location_id = COALESCE(
  (
    SELECT JSON_VALUE(e.data_json, '$.fromLocationId')
    FROM serial_events e
    WHERE e.case_id = c.id AND e.type = 'send' AND JSON_VALID(e.data_json)
    ORDER BY e.seq ASC
    LIMIT 1
  ),
  ''
)
WHERE c.origin_location_id = '';

-- Daftar Laporan: per BU, terbaru dulu.
CREATE INDEX IF NOT EXISTS serial_cases_bu_created ON serial_cases (bu_id, created_at);
