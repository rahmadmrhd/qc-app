import type { BusinessUnitOptionDto, QrPresetDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { QR_LIMITS } from '@shared/qrcode';
import type { LinkOption } from '@/components/link-field';

/** Opsi `LinkField` konfigurasi default QR, disaring lokal menurut teks pencarian (daftar kecil, dimuat penuh). */
export function presetOptions(presets: readonly QrPresetDto[], term: string): LinkOption[] {
  const key = normalizeKey(term);
  return presets
    .filter((preset) => key === '' || normalizeKey(preset.name).includes(key))
    .map((preset) => ({ id: preset.id, label: preset.name }));
}

const CLONE_SUFFIX = ' (salinan)';

/** Nama awal kloning preset: "<nama> (salinan)" (nama preset unik, jadi tak boleh sama dengan sumber), <= batas nama. */
export function cloneNameOf(name: string): string {
  const base = name.slice(0, QR_LIMITS.presetName - CLONE_SUFFIX.length).trimEnd();
  return `${base}${CLONE_SUFFIX}`;
}

/** Opsi `LinkField` BU untuk form preset: hanya BU aktif; BU yang sudah punya preset lain tampil nonaktif. */
export function businessUnitOptions(
  units: readonly BusinessUnitOptionDto[],
  term: string,
  takenBuIds: ReadonlySet<string> = new Set(),
): LinkOption[] {
  const key = normalizeKey(term);
  return units
    .filter((unit) => unit.status === 'active')
    .filter((unit) => key === '' || normalizeKey(unit.name).includes(key))
    .map((unit) => ({
      id: unit.id,
      label: unit.name,
      ...(takenBuIds.has(unit.id)
        ? { disabled: true, description: 'Sudah punya konfigurasi default' }
        : {}),
    }));
}
