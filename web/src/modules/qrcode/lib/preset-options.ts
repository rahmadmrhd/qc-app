import type { QrPresetDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import type { LinkOption } from '@/components/link-field';

/** Opsi `LinkField` konfigurasi default QR, disaring lokal menurut teks pencarian (daftar kecil, dimuat penuh). */
export function presetOptions(presets: readonly QrPresetDto[], term: string): LinkOption[] {
  const key = normalizeKey(term);
  return presets
    .filter((preset) => key === '' || normalizeKey(preset.name).includes(key))
    .map((preset) => ({ id: preset.id, label: preset.name }));
}
