import type { MeDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import type { LinkOption } from '@/components/link-field';

/**
 * Lokasi yang dapat dipilih di form dan filter Serial Number: lokasi aktif yang diketahui pengguna (`me.locations`).
 * Lokasi pada Serial Number bukan pembatas izin (spek §3 butir 3), tetapi belum ada rute pilihan lokasi tersendiri;
 * satu tempat ini yang diganti bila rute itu ada. Lokasi yang sudah tersimpan pada catatan tetap tampil lewat `labelOf`.
 */
export function serialLocationOptions(me: MeDto): LinkOption[] {
  return me.locations.map((location) => ({
    id: location.id,
    label: `${location.name} (${location.code})`,
  }));
}

/** Tanggal hari ini menurut WIB (`YYYY-MM-DD`), bukan jam peramban. */
export function todayWib(now: number = Date.now()): string {
  return wibDateIso(now);
}
