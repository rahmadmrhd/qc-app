import type { MeDto } from '@shared/rpc';
import { locationsWith } from '@/modules/auth/permissions';

/**
 * Lokasi (di antara yang terpilih) tempat user boleh MEMBACA task: `handover: view` ke atas atau `qc: edit`.
 * `me.locations` memuat lokasi dengan modul berlokasi apa pun (mis. hanya stok); lokasi seperti itu tidak boleh
 * ikut diminta ke `handovers.*` karena satu lokasi terlarang menolak seluruh permintaan.
 */
export function readableLocationIds(me: MeDto, selectedIds: readonly string[]): string[] {
  return selectedIds.filter(
    (id) =>
      locationsWith(me, 'handover', 'view', [id]).length > 0 ||
      locationsWith(me, 'qc', 'edit', [id]).length > 0,
  );
}
