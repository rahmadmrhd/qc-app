import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { newId } from '@server/core/id';

/**
 * Firmware awal Country Lock (17), disalin dari daftar tetap lama `FIRMWARE_BY_BRAND` (`shared/firmware.ts`) sebelum
 * berkas itu dihapus. Hanya bahan seed: sesudah ini daftar firmware dikelola admin di tabel `cl_firmwares`.
 */
const INITIAL_FIRMWARES: readonly {
  brand: 'mikrotik' | 'ubiquiti';
  code: string;
  label: string;
}[] = [
  { brand: 'mikrotik', code: 'AC', label: 'AC' },
  { brand: 'mikrotik', code: '5Ghz', label: '5GHz' },
  { brand: 'mikrotik', code: '2Ghz', label: '2GHz' },
  { brand: 'mikrotik', code: 'AC2', label: 'AC2' },
  { brand: 'mikrotik', code: 'ARM', label: 'ARM' },
  { brand: 'mikrotik', code: 'Mantbox 19s', label: 'Mantbox 19s' },
  { brand: 'mikrotik', code: 'AX', label: 'AX' },
  { brand: 'mikrotik', code: 'AX2', label: 'AX2' },
  { brand: 'ubiquiti', code: 'WA', label: 'WA Firmware' },
  { brand: 'ubiquiti', code: '2WA', label: '2WA Firmware' },
  { brand: 'ubiquiti', code: 'LAP120', label: 'LAP120 Firmware' },
  { brand: 'ubiquiti', code: 'XC', label: 'XC Firmware' },
  { brand: 'ubiquiti', code: '2XC', label: '2XC Firmware' },
  { brand: 'ubiquiti', code: 'M', label: 'airMAX M' },
  { brand: 'ubiquiti', code: 'af5xhd', label: 'AF-5XHD' },
  { brand: 'ubiquiti', code: 'XW', label: 'XW Firmware' },
  { brand: 'ubiquiti', code: 'XM', label: 'XM Firmware' },
];

/**
 * Mengisi `cl_firmwares` dengan firmware awal. Idempoten dan aman dijalankan serentak: sebuah `(brand, code)` hanya
 * dimasukkan bila belum ada baris SAMA SEKALI, hidup maupun sudah dihapus admin (firmware yang sengaja dihapus tidak
 * dihidupkan lagi saat start berikutnya); bentrokan serentak di indeks `cl_firmwares_code_live` diabaikan
 * (`ON DUPLICATE KEY UPDATE id = id`). `script_path` kosong dan `parallel` mati: admin/impor mengisinya kemudian.
 * Dipanggil `createServer` tiap start setelah migrasi (bukan migrasi SQL: pemeriksa dump pemulihan menolak DML biasa).
 */
export async function seedCountryLockFirmwares(env: Env): Promise<{ inserted: number }> {
  const now = nowIso(env);
  let inserted = 0;
  const perBrand: Record<string, number> = {};
  for (const firmware of INITIAL_FIRMWARES) {
    const sort = (perBrand[firmware.brand] ?? 0) + 10;
    perBrand[firmware.brand] = sort;
    const result = await env.DB.prepare(
      `INSERT INTO cl_firmwares (id, brand, code, label, script_path, parallel, sort, removed_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, NULL, 0, ?, '', ?, ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM cl_firmwares WHERE brand = ? AND code = ?)
       ON DUPLICATE KEY UPDATE id = id`,
    )
      .bind(
        newId(),
        firmware.brand,
        firmware.code,
        firmware.label,
        sort,
        now,
        now,
        firmware.brand,
        firmware.code,
      )
      .run();
    inserted += result.meta.changes > 0 ? 1 : 0;
  }
  return { inserted };
}
