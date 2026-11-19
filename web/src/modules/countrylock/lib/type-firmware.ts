// Mencocokkan Tipe katalog (Data Item `isCountryLock`) dengan pilihan Merk + Firmware di form inject (spek desktop §6.6,
// keputusan pemilik 2026-11-18): Tipe yang punya kode firmware dan ada di paket skrip mengisi dan mengunci form, seperti
// aplikasi lama. Murni: tanpa efek samping, dites tersendiri.

import type { PackageDto } from '@countrylock/bridge-contract';
import type { Brand } from '@countrylock/script-template';
import type { CatalogItemDto } from '@shared/desktop-catalog';
import { firmwareBrandOf } from '@shared/firmware';

export type TypeApplication =
  | { ok: true; brand: Brand; firmwareCode: string; firmwareLabel: string }
  | { ok: false; message: string };

/** Apakah Tipe ini dapat dipakai untuk mengisi form inject, dan bila tidak, mengapa (pesan untuk operator). */
export function resolveTypeApplication(
  item: Pick<CatalogItemDto, 'brand' | 'firmware'>,
  pkg: Pick<PackageDto, 'config'> | null,
): TypeApplication {
  if (!pkg) return { ok: false, message: 'Pilih folder paket skrip dulu.' };
  const brand = firmwareBrandOf(item.brand);
  const brandConfig = brand ? pkg.config.brands[brand] : undefined;
  if (!brand || !brandConfig) {
    return { ok: false, message: `Merk ${item.brand} tidak ada di paket skrip.` };
  }
  const code = item.firmware ?? '';
  if (code === '') {
    return {
      ok: false,
      message: 'Firmware belum diisi di Data Item. Pilih merk dan firmware secara manual.',
    };
  }
  const entry = brandConfig.firmware.find((firmware) => firmware.code === code);
  if (!entry) {
    return { ok: false, message: `Firmware "${code}" tidak ada di paket skrip.` };
  }
  return { ok: true, brand, firmwareCode: entry.code, firmwareLabel: entry.label || entry.code };
}

/**
 * Tipe katalog yang boleh dipilih untuk Merk tertentu (daftar Tipe di form inject, seperti `UpdateListTipe` aplikasi
 * lama: hanya Tipe milik merk terpilih), diurut menurut nama Tipe (model) agar stabil antar sinkron.
 */
export function tipeOptionsFor(
  items: readonly CatalogItemDto[],
  brand: Brand | null,
): CatalogItemDto[] {
  if (!brand) return [];
  return items
    .filter((item) => firmwareBrandOf(item.brand) === brand)
    .sort((a, b) => a.model.localeCompare(b.model, 'id', { sensitivity: 'base' }));
}
