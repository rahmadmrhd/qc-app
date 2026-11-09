import type { BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { STICKER_LIMITS } from '@shared/stickers';
import { useState } from 'react';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { ImagePicker } from '@/modules/item/components/image-picker';
import { stickerFormSchema } from '../schemas';

export interface StickerSaveInput {
  id?: string;
  typeId: string;
  name: string;
  alias: string;
  fileId: string | null;
  minQty: number;
  businessUnitIds: string[];
}

const FIELD_KEYS = ['typeId', 'name', 'alias', 'fileId', 'minQty', 'businessUnitIds'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Galat simpan: pesan umum dan, bila server menyebut field, pesan khusus field itu. */
export interface StickerSaveFailure extends FieldErrors {
  message: string;
}

export type StickerSaveResult = string | StickerSaveFailure | null;

/** Mengubah galat API menjadi hasil simpan dialog (dipakai pemanggil yang memanggil API stiker). */
export function stickerSaveFailure(error: unknown): StickerSaveFailure {
  return { message: describeError(error), ...pickFieldErrors(error, FIELD_KEYS) };
}

export interface StickerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stiker yang diubah; kosong = stiker baru. */
  sticker?: StickerDto;
  /** Semua jenis; stiker baru hanya dapat memilih jenis aktif, jenis stiker lama tak dapat diubah. */
  types: readonly StickerTypeDto[];
  /** Semua BU; yang aktif ditawarkan, yang nonaktif hanya tampil bila sudah melekat pada stiker. */
  businessUnits: readonly BusinessUnitOptionDto[];
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (input: StickerSaveInput) => Promise<StickerSaveResult>;
}

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${bu.name} (${bu.code})${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

interface BodyProps extends Omit<StickerFormDialogProps, 'open' | 'onOpenChange'> {
  onClose: () => void;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian dan galat selalu mulai bersih. */
function StickerFormBody({ sticker, types, businessUnits, onSave, onClose }: BodyProps) {
  const [typeId, setTypeId] = useState(sticker?.typeId ?? '');
  const [name, setName] = useState(sticker?.name ?? '');
  const [alias, setAlias] = useState(sticker?.alias ?? '');
  const [fileId, setFileId] = useState<string | null>(sticker?.fileId ?? null);
  const [minQty, setMinQty] = useState(sticker ? String(sticker.minQty) : '');
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(sticker?.businessUnitIds ?? []);
  const [buTerm, setBuTerm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedType = types.find((type) => type.id === typeId);
  const needsBusinessUnits = selectedType?.rule === 'bu';
  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));
  const selected = new Set(businessUnitIds);
  const termKey = normalizeKey(buTerm);
  const buOptions: LinkOption[] = businessUnits
    .filter((bu) => bu.status === 'active' && !selected.has(bu.id))
    .filter(
      (bu) =>
        termKey === '' ||
        normalizeKey(bu.name).includes(termKey) ||
        normalizeKey(bu.code).includes(termKey),
    )
    .map((bu) => ({ id: bu.id, label: buLabel(bu) }));
  const typeOptions = types.filter((type) => type.status === 'active');

  function clearError(key: FieldKey) {
    setErrors((current) => ({ ...current, [key]: undefined }));
    setGeneralError(null);
  }

  async function submit() {
    if (busy) return;
    const parsed = stickerFormSchema.safeParse({
      typeId,
      name,
      alias,
      fileId,
      minQty: minQty.trim() === '' ? 0 : Number(minQty),
      businessUnitIds: needsBusinessUnits ? businessUnitIds : [],
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    if (needsBusinessUnits && parsed.data.businessUnitIds.length === 0) {
      setErrors({ businessUnitIds: 'Pilih minimal satu BU' });
      return;
    }
    setBusy(true);
    let failure: StickerSaveFailure | null;
    try {
      const data = parsed.data;
      const input: StickerSaveInput = sticker ? { id: sticker.id, ...data } : { ...data };
      const result = await onSave(input);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      failure = { message: 'Gagal menyimpan stiker' };
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
        {sticker ? (
          <>
            <p className="text-sm font-medium">Jenis</p>
            <p className="text-sm">{sticker.typeName}</p>
            <p className="text-xs text-muted-foreground">
              Jenis tidak dapat diubah setelah stiker dibuat.
            </p>
          </>
        ) : (
          <>
            <Label htmlFor="sticker-form-type">Jenis</Label>
            <NativeSelect
              id="sticker-form-type"
              value={typeId}
              aria-invalid={errors.typeId ? true : undefined}
              onChange={(event) => {
                const next = event.target.value;
                setTypeId(next);
                clearError('typeId');
                // Jenis tanpa aturan BU tidak boleh memuat BU: kosongkan pilihan lama.
                if (types.find((type) => type.id === next)?.rule !== 'bu') setBusinessUnitIds([]);
              }}
            >
              <option value="">Pilih jenis</option>
              {typeOptions.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        <FieldError id="sticker-form-type-error" message={errors.typeId} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-name">Nama stiker</Label>
        <Input
          id="sticker-form-name"
          autoFocus
          maxLength={STICKER_LIMITS.nameMax}
          value={name}
          aria-invalid={errors.name || generalError ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            clearError('name');
          }}
        />
        <FieldError
          id="sticker-form-name-error"
          message={errors.name ?? generalError ?? undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-alias">Alias</Label>
        <Input
          id="sticker-form-alias"
          maxLength={STICKER_LIMITS.aliasMax}
          value={alias}
          aria-invalid={errors.alias ? true : undefined}
          onChange={(event) => {
            setAlias(event.target.value);
            clearError('alias');
          }}
        />
        <p className="text-xs text-muted-foreground">
          Nama tampilan untuk tim QC; bila diisi, tampil menggantikan nama.
        </p>
        <FieldError id="sticker-form-alias-error" message={errors.alias} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Gambar contoh</p>
        <ImagePicker
          value={fileId}
          label={name.trim() || 'stiker'}
          onChange={(id) => {
            setFileId(id);
            clearError('fileId');
          }}
        />
        <FieldError id="sticker-form-file-error" message={errors.fileId} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-min-qty">Batas minimum</Label>
        <Input
          id="sticker-form-min-qty"
          type="number"
          inputMode="numeric"
          min={0}
          max={STICKER_LIMITS.qtyMax}
          step={1}
          placeholder="0"
          value={minQty}
          aria-invalid={errors.minQty ? true : undefined}
          onChange={(event) => {
            setMinQty(event.target.value);
            clearError('minQty');
          }}
        />
        <p className="text-xs text-muted-foreground">
          Peringatan "Menipis" bila total stok semua lokasi mencapai batas ini; 0 = tanpa
          peringatan.
        </p>
        <FieldError id="sticker-form-min-qty-error" message={errors.minQty} />
      </div>
      {needsBusinessUnits ? (
        <LinkMultiField
          id="sticker-form-business-units"
          label="BU"
          placeholder="Pilih BU"
          value={businessUnitIds}
          labelOf={(id) => {
            const bu = buById.get(id);
            return bu ? buLabel(bu) : id;
          }}
          options={buOptions}
          onSearchChange={setBuTerm}
          onChange={(ids) => {
            setBusinessUnitIds(ids);
            clearError('businessUnitIds');
          }}
          error={errors.businessUnitIds}
        />
      ) : null}
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={busy || name.trim() === '' || typeId === ''}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </FormDialogFooter>
    </form>
  );
}

/** Dialog tambah/ubah stiker; field BU hanya muncul untuk jenis berrule `bu`, jenis tak dapat diubah saat ubah. */
export function StickerFormDialog({
  open,
  onOpenChange,
  sticker,
  types,
  businessUnits,
  onSave,
}: StickerFormDialogProps) {
  const title = sticker ? `Ubah stiker ${sticker.alias || sticker.name}` : 'Tambah stiker';
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className="max-h-[90vh] overflow-y-auto">
        <FormDialogHeader>
          <FormDialogTitle>{title}</FormDialogTitle>
          <FormDialogDescription>
            Stiker tidak dihapus, hanya dinonaktifkan. Gambar contoh membantu tim QC mengenalinya.
          </FormDialogDescription>
        </FormDialogHeader>
        {open ? (
          <StickerFormBody
            key={sticker?.id ?? 'new'}
            sticker={sticker}
            types={types}
            businessUnits={businessUnits}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
