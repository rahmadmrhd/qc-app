import { formatBuLabel } from '@shared/business-units';
import type {
  BrandDto,
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
} from '@shared/contract';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { BusinessUnitFormDialog } from '@/modules/access/components/business-unit-form-dialog';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';

export interface BrandSaveInput {
  id?: string;
  name: string;
  /** BU bawaan merk (boleh kosong). */
  businessUnitIds: string[];
}

/** Galat simpan: pesan umum, dan pesan khusus field BU bila server menolak BU bawaan (422 `fields.businessUnitIds`). */
export interface BrandSaveFailure {
  message: string;
  businessUnitIds?: string;
}

export type BrandSaveResult = string | BrandSaveFailure | null;

/** Mengubah galat API menjadi hasil simpan dialog (dipakai pemanggil yang memanggil API merk). */
export function brandSaveFailure(error: unknown): BrandSaveFailure {
  const businessUnitIds = pickFieldErrors(error, ['businessUnitIds'] as const).businessUnitIds;
  const message = describeError(error);
  return businessUnitIds ? { message, businessUnitIds } : { message };
}

export interface BrandFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Merk yang diganti namanya; kosong = merk baru (BU bawaan awal kosong). */
  brand?: Pick<BrandDto, 'id' | 'name' | 'businessUnitIds'>;
  /** Semua BU; yang aktif ditawarkan, yang nonaktif hanya tampil bila sudah melekat pada merk. */
  businessUnits: readonly BusinessUnitOptionDto[];
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (input: BrandSaveInput) => Promise<BrandSaveResult>;
  /** Membuat BU baru dari baris "Tambah BU bawaan" (hanya untuk `access: manage`); BU baru langsung terpilih. */
  onCreateBusinessUnit?: (input: SaveBusinessUnitInput) => Promise<BusinessUnitDto>;
  /** Tautan ke halaman lihat BU (tab baru); tidak disediakan bila user tak berhak melihatnya. */
  openBusinessUnitHref?: (id: string) => string | null;
}

export interface BrandFormProps {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  brand?: Pick<BrandDto, 'id' | 'name' | 'businessUnitIds'>;
  businessUnits: readonly BusinessUnitOptionDto[];
  onSave: BrandFormDialogProps['onSave'];
  onCreateBusinessUnit: BrandFormDialogProps['onCreateBusinessUnit'];
  openBusinessUnitHref: BrandFormDialogProps['openBusinessUnitHref'];
  /** Dipanggil setelah simpan berhasil. */
  onClose: () => void;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
}

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${formatBuLabel(bu)}${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

/**
 * Field form merk (nama + BU bawaan): hanya `<form id={formId}>`, tanpa tombol. Terpasang hanya saat dialog terbuka,
 * sehingga isian dan galat selalu mulai bersih.
 */
export function BrandForm({
  formId,
  brand,
  businessUnits,
  onSave,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  onClose,
  onBusyChange,
}: BrandFormProps) {
  // Ponsel: tanpa fokus otomatis (papan ketik layar akan menutupi separuh form; review audit K9).
  const desktop = useIsDesktop();
  const [name, setName] = useState(brand?.name ?? '');
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(brand?.businessUnitIds ?? []);
  const [buTerm, setBuTerm] = useState('');
  // BU yang baru dibuat lewat dialog langsung bisa dilabeli, sebelum daftar BU dari server dimuat ulang.
  const [createdBus, setCreatedBus] = useState<readonly BusinessUnitOptionDto[]>([]);
  const [buDialogOpen, setBuDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buError, setBuError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(
    name !== (brand?.name ?? '') ||
      [...businessUnitIds].sort().join('|') !==
        [...(brand?.businessUnitIds ?? [])].sort().join('|'),
  );

  const allBus = [
    ...businessUnits,
    ...createdBus.filter((c) => !businessUnits.some((b) => b.id === c.id)),
  ];
  const buById = new Map(allBus.map((bu) => [bu.id, bu]));
  const selected = new Set(businessUnitIds);
  const termKey = normalizeKey(buTerm);
  // Opsi tambah = BU aktif yang belum dipilih; BU nonaktif yang sudah melekat tetap tampil sebagai chip.
  const buOptions: LinkOption[] = allBus
    .filter((bu) => bu.status === 'active' && !selected.has(bu.id))
    .filter(
      (bu) =>
        termKey === '' ||
        normalizeKey(bu.name).includes(termKey) ||
        normalizeKey(bu.code).includes(termKey),
    )
    .map((bu) => ({ id: bu.id, label: buLabel(bu) }));

  async function handleCreateBusinessUnit(input: SaveBusinessUnitInput): Promise<void> {
    if (!onCreateBusinessUnit) throw new Error('Anda tidak berhak membuat BU');
    const created = await onCreateBusinessUnit(input);
    setCreatedBus((previous) => [
      ...previous,
      { id: created.id, code: created.code, name: created.name, status: created.status },
    ]);
    setBusinessUnitIds((previous) => [...previous, created.id]);
    setBuError(null);
  }

  async function submit() {
    if (busy) return;
    if (name.trim() === '') {
      setError('Nama merk wajib diisi');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    let failure: BrandSaveFailure | null;
    try {
      const input = brand ? { id: brand.id, name, businessUnitIds } : { name, businessUnitIds };
      const result = await onSave(input);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      failure = { message: 'Gagal menyimpan merk' };
    }
    setBusy(false);
    onBusyChange?.(false);
    setError(failure?.message ?? null);
    setBuError(failure?.businessUnitIds ?? null);
    if (failure === null) onClose();
  }

  return (
    <>
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Dialog ini bisa dibuka dari dalam form lain (form item): submit tidak boleh menjalar ke sana.
          event.stopPropagation();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="brand-form-name" required>
            Nama merk
          </Label>
          <Input
            id="brand-form-name"
            aria-required="true"
            autoFocus={desktop}
            maxLength={ITEM_LIMITS.brand}
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'brand-form-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p id="brand-form-error" role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          ) : null}
        </div>
        <LinkMultiField
          id="brand-form-business-units"
          label="BU bawaan"
          placeholder="Pilih BU bawaan"
          value={businessUnitIds}
          labelOf={(id) => {
            const bu = buById.get(id);
            return bu ? buLabel(bu) : id;
          }}
          options={buOptions}
          onSearchChange={setBuTerm}
          searchDebounceMs={0}
          onCreate={onCreateBusinessUnit ? () => setBuDialogOpen(true) : undefined}
          openHref={openBusinessUnitHref}
          onChange={(ids) => {
            setBusinessUnitIds(ids);
            setBuError(null);
          }}
          error={buError ?? undefined}
        />
        {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di footer dialog (di luar form). */}
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
      {/* Dialog turunan di luar <form>: event submit dari portalnya tidak menjalar ke form merk. */}
      {onCreateBusinessUnit ? (
        <BusinessUnitFormDialog
          open={buDialogOpen}
          onOpenChange={setBuDialogOpen}
          onSave={handleCreateBusinessUnit}
        />
      ) : null}
    </>
  );
}

export const BRAND_FORM_ID = 'brand-form';

/** Dialog tambah/ganti nama merk beserta BU bawaan; dipakai halaman Merk dan tombol "Tambah" pada field Merk di form item. */
export function BrandFormDialog({
  open,
  onOpenChange,
  brand,
  businessUnits,
  onSave,
  onCreateBusinessUnit,
  openBusinessUnitHref,
}: BrandFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={BRAND_FORM_ID}
      title={brand ? `Ubah merk ${brand.name}` : 'Tambah merk'}
      description={
        brand
          ? 'Mengganti nama berlaku untuk semua item merk ini.'
          : 'Merk baru langsung dapat dipilih.'
      }
      submitting={busy}
    >
      {open ? (
        <BrandForm
          key={brand?.id ?? 'new'}
          formId={BRAND_FORM_ID}
          brand={brand}
          businessUnits={businessUnits}
          onSave={onSave}
          onCreateBusinessUnit={onCreateBusinessUnit}
          openBusinessUnitHref={openBusinessUnitHref}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
