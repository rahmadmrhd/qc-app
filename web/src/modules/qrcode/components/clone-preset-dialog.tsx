import { formatBuLabel } from '@shared/business-units';
import type { BusinessUnitOptionDto, ClonePresetInput, QrPresetDto } from '@shared/contract';
import { QR_LIMITS } from '@shared/qrcode';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { LinkField } from '@/components/link-field';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitOptions, cloneNameOf } from '../lib/preset-options';

export interface ClonePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preset yang dikloning. */
  source: QrPresetDto;
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Semua preset (BU yang sudah punya preset tidak ditawarkan sebagai tujuan). */
  presets: readonly QrPresetDto[];
  /** Mengirim kloning; melempar galat bila gagal (pesannya ditampilkan di dialog). */
  onClone: (input: ClonePresetInput) => Promise<unknown>;
}

/** Kloning preset ke BU lain: seluruh isi disalin, hanya BU dan nama yang diganti (spek 4a butir 23). */
export function ClonePresetDialog({
  open,
  onOpenChange,
  source,
  businessUnits,
  presets,
  onClone,
}: ClonePresetDialogProps) {
  const [buId, setBuId] = useState('');
  const [term, setTerm] = useState('');
  const [name, setName] = useState(cloneNameOf(source.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(open && (buId !== '' || name !== cloneNameOf(source.name)));
  const taken = new Set(presets.map((preset) => preset.buId).filter((id) => id !== ''));
  const options = businessUnitOptions(businessUnits, term).filter(
    (option) => !taken.has(option.id),
  );
  const trimmed = name.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onClone({ id: source.id, buId, name: trimmed });
      onOpenChange(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kloning ke BU lain</DialogTitle>
          <DialogDescription>
            Seluruh isi "{source.name}" (gaya, ukuran, logo awal, penempatan nama) disalin; hanya
            Business Unit dan nama yang diganti.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LinkField
            id="qr-clone-bu"
            required
            label="Business Unit tujuan"
            placeholder="Pilih Business Unit…"
            value={buId === '' ? null : buId}
            labelOf={(id) => {
              const unit = businessUnits.find((entry) => entry.id === id);
              return unit ? formatBuLabel(unit) : undefined;
            }}
            options={options}
            onSearchChange={setTerm}
            searchDebounceMs={0}
            onChange={(id) => setBuId(id ?? '')}
          />
          <div className="space-y-1.5">
            <Label htmlFor="qr-clone-name" required>
              Nama preset baru
            </Label>
            <Input
              id="qr-clone-name"
              aria-required="true"
              value={name}
              maxLength={QR_LIMITS.presetName}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <FieldError errors={error ? [error] : []} />
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
            disabled={busy || buId === '' || trimmed === ''}
            onClick={() => void submit()}
          >
            {busy ? <BusyLabel>Mengkloning…</BusyLabel> : 'Kloning'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
