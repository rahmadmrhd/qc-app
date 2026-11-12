import type { MeDto, SerialLocationOptionDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import type { LinkOption } from '@/components/link-field';

/** Lokasi dari `serials.locationOptions` -> pilihan `LinkField` ("Nama (KODE)"). */
export function toLocationOptions(locations: readonly SerialLocationOptionDto[]): LinkOption[] {
  return locations.map((location) => ({
    id: location.id,
    label: `${location.name} (${location.code})`,
  }));
}

/** Lokasi yang diketahui pengguna (`me.locations`): sumber pilihan lokasi bagi pembaca tanpa `serial: edit`. */
export function meLocationOptions(me: MeDto): LinkOption[] {
  return me.locations.map((location) => ({
    id: location.id,
    label: `${location.name} (${location.code})`,
  }));
}

/** Tanggal hari ini menurut WIB (`YYYY-MM-DD`), bukan jam peramban. */
export function todayWib(now: number = Date.now()): string {
  return wibDateIso(now);
}
