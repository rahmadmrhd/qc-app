import type { AdjustStockInput, RecordStockInput, StickerStockDto } from '@shared/contract';
import { formatStockQty, piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { useState } from 'react';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { LocationField } from '@/modules/location/location-field';
import { CountInput, cleanCount, emptyCount } from './count-input';

export type StockEntryMode = 'in' | 'out' | 'adjust';

/** Tulisan stok yang dikirim dialog: catat masuk/keluar atau koreksi. */
export type StockWrite =
  | { type: 'record'; input: RecordStockInput }
  | { type: 'adjust'; input: AdjustStockInput };

const FIELD_KEYS = ['locationId', 'quantity', 'count', 'delta', 'reason'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Galat simpan: pesan umum dan, bila server menyebut field, pesan khusus field itu. */
export interface StockSaveFailure extends FieldErrors {
  message: string;
}

export type StockSaveResult = string | StockSaveFailure | null;

/** Mengubah galat API menjadi hasil simpan dialog. */
export function stockSaveFailure(error: unknown): StockSaveFailure {
  return { message: describeError(error), ...pickFieldErrors(error, FIELD_KEYS) };
}

const TITLES: Record<StockEntryMode, string> = {
  in: 'Catat stok masuk',
  out: 'Catat stok keluar',
  adjust: 'Koreksi stok',
};

const DESCRIPTIONS: Record<StockEntryMode, string> = {
  in: 'Menambah stok di satu lokasi.',
  out: 'Mengurangi stok di satu lokasi; alasan wajib diisi.',
  adjust: 'Mengubah stok dengan selisih bertanda (+ atau −); alasan wajib diisi.',
};

export interface StockEntryDialogProps {
  /** `null` = tertutup. */
  mode: StockEntryMode | null;
  sticker: StickerStockDto | null;
  onOpenChange: (open: boolean) => void;
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (write: StockWrite) => Promise<StockSaveResult>;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** Pesan galat jumlah butir (masuk/keluar): kosong, bukan bilangan bulat, di bawah 1, atau melebihi batas. */
function quantityError(text: string): string | null {
  if (text.trim() === '') return 'Jumlah wajib diisi (minimal 1 butir)';
  const value = Number(text);
  if (!Number.isInteger(value)) return 'Jumlah harus bilangan bulat';
  if (value < 1) return 'Jumlah minimal 1 butir';
  if (value > STICKER_LIMITS.qtyMax) return `Jumlah maksimal ${STICKER_LIMITS.qtyMax}`;
  return null;
}

/** Pesan galat selisih koreksi: kosong/0, bukan bilangan bulat, atau melebihi batas. */
function deltaError(text: string): string | null {
  const value = Number(text);
  if (text.trim() === '' || value === 0) return 'Perubahan wajib diisi (bukan 0)';
  if (!Number.isInteger(value)) return 'Perubahan harus bilangan bulat';
  if (Math.abs(value) > STICKER_LIMITS.qtyMax) {
    return `Perubahan maksimal ${STICKER_LIMITS.qtyMax} (boleh negatif)`;
  }
  return null;
}

interface BodyProps {
  mode: StockEntryMode;
  sticker: StickerStockDto;
  onSave: StockEntryDialogProps['onSave'];
  onClose: () => void;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian dan galat selalu mulai bersih. */
function StockEntryBody({ mode, sticker, onSave, onClose }: BodyProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const level = mode === 'adjust' ? 'manage' : 'edit';
  const writable = locationsWith(me, 'stickerstock', level, selectedIds);
  // Satu-satunya lokasi yang boleh ditulis dipilih otomatis; selebihnya user memilih sendiri.
  const [locationId, setLocationId] = useState(
    writable.length === 1 ? (writable[0]?.id ?? '') : '',
  );
  const [method, setMethod] = useState<'quantity' | 'count'>('quantity');
  const [quantity, setQuantity] = useState('');
  const [count, setCount] = useState<StockCount>(emptyCount);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currentQty = sticker.byLocation.find((entry) => entry.locationId === locationId)?.qty;
  const reasonRequired = mode !== 'in';

  function clearError(key: FieldKey) {
    setErrors((current) => ({ ...current, [key]: undefined }));
    setGeneralError(null);
  }

  function validate(): { write: StockWrite } | { errors: FieldErrors } {
    const found: FieldErrors = {};
    const trimmedReason = reason.trim();
    if (locationId === '') found.locationId = 'Pilih lokasi';
    if (reasonRequired && trimmedReason === '') found.reason = 'Alasan wajib diisi';
    if (mode === 'adjust') {
      const problem = deltaError(delta);
      if (problem) found.delta = problem;
      if (Object.keys(found).length > 0) return { errors: found };
      return {
        write: {
          type: 'adjust',
          input: {
            locationId,
            stickerId: sticker.stickerId,
            delta: Number(delta),
            reason: trimmedReason,
          },
        },
      };
    }
    let quantityValue: number | undefined;
    let countValue: StockCount | undefined;
    if (method === 'quantity') {
      const problem = quantityError(quantity);
      if (problem) found.quantity = problem;
      else quantityValue = Number(quantity);
    } else {
      const cleaned = cleanCount(count);
      const pieces = piecesOfCount(cleaned);
      if (pieces < 1) {
        found.count = 'Hitungan minimal 1 butir';
      } else if (pieces > STICKER_LIMITS.qtyMax) {
        found.count = `Jumlah butir maksimal ${STICKER_LIMITS.qtyMax}`;
      } else {
        countValue = cleaned;
      }
    }
    if (Object.keys(found).length > 0) return { errors: found };
    return {
      write: {
        type: 'record',
        input: {
          locationId,
          stickerId: sticker.stickerId,
          kind: mode,
          reason: trimmedReason,
          ...(quantityValue === undefined ? {} : { quantity: quantityValue }),
          ...(countValue === undefined ? {} : { count: countValue }),
        },
      },
    };
  }

  async function submit() {
    if (busy) return;
    const checked = validate();
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    let failure: StockSaveFailure | null;
    try {
      const result = await onSave(checked.write);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      failure = { message: 'Gagal menyimpan stok' };
    }
    setBusy(false);
    if (failure === null) {
      onClose();
      return;
    }
    const { message, ...fields } = failure;
    setErrors(fields);
    setGeneralError(Object.values(fields).some(Boolean) ? null : message);
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <LocationField
          id="stock-entry-location"
          module="stickerstock"
          level={level}
          value={locationId}
          onChange={(id) => {
            setLocationId(id);
            clearError('locationId');
          }}
        />
        {currentQty !== undefined ? (
          <p className="text-xs text-muted-foreground">{`Stok saat ini: ${currentQty < 0 ? formatStockQty(currentQty) : `${currentQty} butir`}`}</p>
        ) : null}
        <FieldError message={errors.locationId} />
      </div>
      {mode === 'adjust' ? (
        <div className="space-y-1.5">
          <Label htmlFor="stock-entry-delta">Perubahan (butir)</Label>
          <Input
            id="stock-entry-delta"
            type="number"
            inputMode="numeric"
            step={1}
            placeholder="mis. -5 atau 10"
            value={delta}
            aria-invalid={errors.delta ? true : undefined}
            onChange={(event) => {
              setDelta(event.target.value);
              clearError('delta');
            }}
          />
          <FieldError message={errors.delta} />
        </div>
      ) : (
        <>
          <Select
            id="stock-entry-method"
            label="Cara input"
            options={[
              { value: 'quantity', label: 'Jumlah butir' },
              { value: 'count', label: 'Hitung lembar' },
            ]}
            value={method}
            onValueChange={(next) => setMethod(next as 'quantity' | 'count')}
          />
          {method === 'quantity' ? (
            <div className="space-y-1.5">
              <Label htmlFor="stock-entry-quantity">Jumlah butir</Label>
              <Input
                id="stock-entry-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={STICKER_LIMITS.qtyMax}
                step={1}
                value={quantity}
                aria-invalid={errors.quantity ? true : undefined}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  clearError('quantity');
                }}
              />
              <FieldError message={errors.quantity} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <CountInput
                value={count}
                onChange={(next) => {
                  setCount(next);
                  clearError('count');
                }}
              />
              <FieldError message={errors.count} />
            </div>
          )}
        </>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="stock-entry-reason">
          {reasonRequired ? 'Alasan' : 'Catatan (opsional)'}
        </Label>
        <Input
          id="stock-entry-reason"
          maxLength={STICKER_LIMITS.reasonMax}
          value={reason}
          aria-invalid={errors.reason ? true : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            clearError('reason');
          }}
        />
        <FieldError message={errors.reason} />
      </div>
      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </FormDialogFooter>
    </form>
  );
}

/** Dialog catat stok masuk/keluar dan koreksi untuk satu stiker. */
export function StockEntryDialog({ mode, sticker, onOpenChange, onSave }: StockEntryDialogProps) {
  const open = mode !== null && sticker !== null;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent>
        <FormDialogHeader>
          <FormDialogTitle>
            {mode && sticker ? `${TITLES[mode]}: ${sticker.name}` : 'Stok stiker'}
          </FormDialogTitle>
          <FormDialogDescription>{mode ? DESCRIPTIONS[mode] : ''}</FormDialogDescription>
        </FormDialogHeader>
        {mode && sticker ? (
          <StockEntryBody
            key={`${mode}:${sticker.stickerId}`}
            mode={mode}
            sticker={sticker}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
