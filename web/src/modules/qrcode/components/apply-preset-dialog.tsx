import type { QrPresetDto } from '@shared/contract';
import { useState } from 'react';
import { LinkField } from '@/components/link-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { presetOptions } from '../lib/preset-options';
import type { PresetApplyParts } from '../schemas';

const PART_LABELS: ReadonlyArray<readonly [keyof PresetApplyParts, string]> = [
  ['title', 'Title'],
  ['subtitle', 'Subtitle'],
  ['footer', 'Footer'],
  ['logo', 'Logo'],
];

export interface ApplyPresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: readonly QrPresetDto[];
  onApply: (preset: QrPresetDto, parts: PresetApplyParts) => void;
}

/** Memperbarui isian form dari konfigurasi default: teks dan logo opsional, gaya/ukuran/bingkai selalu ikut. */
export function ApplyPresetDialog({
  open,
  onOpenChange,
  presets,
  onApply,
}: ApplyPresetDialogProps) {
  const [presetId, setPresetId] = useState('');
  const [presetTerm, setPresetTerm] = useState('');
  const [parts, setParts] = useState<PresetApplyParts>({
    title: true,
    subtitle: true,
    footer: true,
    logo: true,
  });
  const preset = presets.find((item) => item.id === presetId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Perbarui sesuai konfigurasi default</DialogTitle>
          <DialogDescription>
            Isian form diganti dari konfigurasi default yang dipilih. Gaya teks, ukuran, dan bingkai
            selalu ikut; sumber link tidak berubah. Perubahan baru tersimpan saat Anda menyimpan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LinkField
            id="qr-apply-preset"
            required
            label="Konfigurasi default"
            placeholder="Pilih konfigurasi default…"
            value={presetId === '' ? null : presetId}
            labelOf={(id) => presets.find((item) => item.id === id)?.name}
            options={presetOptions(presets, presetTerm)}
            onSearchChange={setPresetTerm}
            searchDebounceMs={0}
            onChange={(id) => setPresetId(id ?? '')}
          />
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Ikut disalin ulang</legend>
            {PART_LABELS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={parts[key]}
                  onChange={(event) => setParts({ ...parts, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Bagian yang tidak dicentang dipertahankan seperti di form.
            </p>
          </fieldset>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="primary"
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            type="button"
            disabled={!preset}
            onClick={() => {
              if (!preset) return;
              onApply(preset, parts);
              onOpenChange(false);
            }}
          >
            Terapkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
