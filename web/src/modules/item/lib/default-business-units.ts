import type { BrandDto, BusinessUnitOptionDto, BusinessUnitRefDto } from '@shared/contract';

/**
 * BU yang diisi otomatis saat merk dipilih: BU bawaan merk yang juga boleh diisi user (aktif dan ber-`edit`).
 * BU bawaan di luar hak disaring, bukan ditolak diam-diam; urutan mengikuti BU bawaan merk.
 */
export function defaultBusinessUnitIds(
  brand: Pick<BrandDto, 'businessUnitIds'> | undefined,
  editableActiveBuIds: readonly string[],
): string[] {
  if (!brand) return [];
  const allowed = new Set(editableActiveBuIds);
  return brand.businessUnitIds.filter((id) => allowed.has(id));
}

/**
 * Daftar BU untuk form item: pilihan dari server ditambah BU yang sudah melekat pada item tetapi tak ada di daftar
 * (dianggap aktif; label nonaktif hanya muncul bila server menandainya).
 */
export function mergeBusinessUnits(
  options: readonly BusinessUnitOptionDto[],
  attached: readonly BusinessUnitRefDto[] = [],
): BusinessUnitOptionDto[] {
  const known = new Set(options.map((bu) => bu.id));
  return [
    ...options,
    ...attached
      .filter((bu) => !known.has(bu.id))
      .map((bu) => ({ ...bu, status: 'active' as const })),
  ];
}
