-- Nomor riwayat Gudang (WH): `OUT/<kode BU>/<YYMM>-<urutan>` untuk Penjualan (pengeluaran ke SO) dan
-- `RS/<kode BU>/<YYMM>-<urutan>` untuk Ready Stock. Expand-only, idempoten.
-- Pengeluaran lama diberi nomor menurut urutan dibuat per (awalan, BU, bulan WIB), lalu penghitung `counters`
-- (`whd:<awalan>:<kode BU>:<YYMM>`) disamakan dengan nomor tertinggi agar nomor baru melanjutkan urutan.
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS number VARCHAR(64) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS warehouse_dispatches_number ON warehouse_dispatches (number);

UPDATE warehouse_dispatches d
JOIN (
  SELECT x.id,
    CONCAT(x.prefix, '/', x.bu_code, '/', x.period, '-', LPAD(ROW_NUMBER() OVER (PARTITION BY x.prefix, x.bu_code, x.period ORDER BY x.created_at, x.id), 4, '0')) AS number
  FROM (
    SELECT wd.id, wd.created_at,
      IF(wd.kind = 'ready', 'RS', 'OUT') AS prefix,
      bu.code AS bu_code,
      DATE_FORMAT(DATE_ADD(STR_TO_DATE(LEFT(wd.created_at, 19), '%Y-%m-%dT%H:%i:%s'), INTERVAL 7 HOUR), '%y%m') AS period
    FROM warehouse_dispatches wd
    LEFT JOIN warehouse_orders wo ON wo.id = wd.order_id
    JOIN business_units bu ON bu.id = IF(wd.kind = 'ready', wd.bu_id, wo.bu_id)
    WHERE wd.number = ''
  ) x
) n ON n.id = d.id
SET d.number = n.number;

INSERT INTO counters (`key`, value)
SELECT CONCAT('whd:', SUBSTRING_INDEX(number, '/', 1), ':', SUBSTRING_INDEX(SUBSTRING_INDEX(number, '/', 2), '/', -1), ':', LEFT(SUBSTRING_INDEX(number, '/', -1), 4)) AS k,
  MAX(CAST(SUBSTRING_INDEX(number, '-', -1) AS UNSIGNED)) AS v
FROM warehouse_dispatches
WHERE number <> ''
GROUP BY k
ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value));
