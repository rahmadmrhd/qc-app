import { SERIAL_LIMITS } from '@shared/serials';
import { Minus, Plus } from 'lucide-react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SerialLocationField } from './serial-location-field';

/** Satu baris stiker pada cek ulang: jumlah tersimpan tidak bisa diturunkan, stiker nonaktif tidak bisa ditambah. */
export interface StickerRow {
  stickerId: string;
  name: string;
  /** Jumlah tersimpan (batas bawah); 0 = stiker belum ditempel. */
  base: number;
  inactive: boolean;
}

export interface StickerQtyListProps {
  rows: readonly StickerRow[];
  qty: ReadonlyMap<string, number>;
  onStep: (row: StickerRow, delta: number) => void;
  error?: string | undefined;
}

/** Pencacah jumlah stiker (logika 5a): naik boleh, turun tidak di bawah jumlah tersimpan. */
export function StickerQtyList({ rows, qty, onStep, error }: StickerQtyListProps) {
  if (rows.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Stiker (jumlah tidak bisa dikurangi)</legend>
      <ul className="space-y-2">
        {rows.map((row) => {
          const value = qty.get(row.stickerId) ?? row.base;
          return (
            <li key={row.stickerId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{row.name}</span>
                {row.inactive ? (
                  <span className="block text-xs text-muted-foreground">
                    Stiker nonaktif: jumlah tidak bisa ditambah
                  </span>
                ) : null}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label={`Kurangi ${row.name}`}
                  disabled={value <= row.base}
                  onClick={() => onStep(row, -1)}
                >
                  <Minus aria-hidden />
                </Button>
                <output
                  aria-label={`Jumlah ${row.name}`}
                  className="w-6 text-center text-sm tabular-nums"
                >
                  {value}
                </output>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label={`Tambah ${row.name}`}
                  disabled={row.inactive || value >= SERIAL_LIMITS.stickerQtyMax}
                  onClick={() => onStep(row, 1)}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <FieldError errors={[error]} />
    </fieldset>
  );
}

export interface DamageFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  error?: string | undefined;
  disabled?: boolean;
}

/** Kerusakan: satu baris, maks. `damageMax`. */
export function DamageField({ id, value, onChange, required, error, disabled }: DamageFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{required ? 'Kerusakan' : 'Kerusakan (opsional)'}</Label>
      <Input
        id={id}
        value={value}
        maxLength={SERIAL_LIMITS.damageMax}
        aria-invalid={error ? true : undefined}
        placeholder="Misalnya: port 3 mati, LED tidak menyala"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
      />
      <FieldError errors={[error]} />
    </div>
  );
}

export interface SendFieldsProps {
  location: { id: string; label: string };
  onLocationChange: (id: string, label: string) => void;
  shipmentNote: string;
  onShipmentNoteChange: (value: string) => void;
  locationError?: string | undefined;
  noteError?: string | undefined;
  disabled?: boolean;
}

/** Tujuan pengiriman (`LinkField`, tanpa Tambah/Buka) dan catatan pengiriman satu baris. */
export function SendFields({
  location,
  onLocationChange,
  shipmentNote,
  onShipmentNoteChange,
  locationError,
  noteError,
  disabled,
}: SendFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SerialLocationField
        id="act-to-location"
        label="Lokasi tujuan"
        placeholder="Pilih lokasi tujuan…"
        value={location.id}
        valueLabel={location.label}
        onChange={onLocationChange}
        error={locationError}
        {...(disabled !== undefined ? { disabled } : {})}
      />
      <div className="space-y-1.5">
        <Label htmlFor="act-shipment-note">Catatan pengiriman (opsional)</Label>
        <Input
          id="act-shipment-note"
          value={shipmentNote}
          maxLength={SERIAL_LIMITS.shipmentNoteMax}
          placeholder="Ekspedisi, nomor resi, atau nama pengantar"
          aria-invalid={noteError ? true : undefined}
          disabled={disabled}
          onChange={(event) => onShipmentNoteChange(event.target.value.replace(/[\r\n]+/g, ' '))}
        />
        <FieldError errors={[noteError]} />
      </div>
    </div>
  );
}
