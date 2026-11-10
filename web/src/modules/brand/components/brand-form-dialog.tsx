import type {
  BrandDto,
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
} from '@shared/contract';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface BrandFormBodyProps {
  brand?: Pick<BrandDto, 'id' | 'name' | 'businessUnitIds'>;
  businessUnits: readonly BusinessUnitOptionDto[];
  onSave: BrandFormDialogProps['onSave'];
  onCreateBusinessUnit: BrandFormDialogProps['onCreateBusinessUnit'];
  openBusinessUnitHref: BrandFormDialogProps['openBusinessUnitHref'];
  onClose: () => void;
}

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${bu.name} (${bu.code})${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian dan galat selalu mulai bersih. */
function BrandFormBody({
  brand,
  businessUnits,
  onSave,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  onClose,
}: BrandFormBodyProps) {
  const [name, setName] = useState(brand?.name ?? '');
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(brand?.businessUnitIds ?? []);
  const [buTerm, setBuTerm] = useState('');
  // BU yang baru dibuat lewat dialog langsung bisa dilabeli, sebelum daftar BU dari server dimuat ulang.
  const [createdBus, setCreatedBus] = useState<readonly BusinessUnitOptionDto[]>([]);
  const [buDialogOpen, setBuDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buError, setBuError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (busy || name.trim() === '') return;
    setBusy(true);
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
    setError(failure?.message ?? null);
    setBuError(failure?.businessUnitIds ?? null);
    if (failure === null) onClose();
  }

  return (
    <>
      <form
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
          <Label htmlFor="brand-form-name">Nama merk</Label>
          <Input
            id="brand-form-name"
            autoFocus
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
            <p id="brand-form-error" role="alert" className="text-sm text-destructive">
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
          onCreate={onCreateBusinessUnit ? () => setBuDialogOpen(true) : undefined}
          openHref={openBusinessUnitHref}
          onChange={(ids) => {
            setBusinessUnitIds(ids);
            setBuError(null);
          }}
          error={buError ?? undefined}
        />
        <FormDialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </FormDialogFooter>
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
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent>
        <FormDialogHeader>
          <FormDialogTitle>{brand ? `Ubah merk ${brand.name}` : 'Tambah merk'}</FormDialogTitle>
          <FormDialogDescription>
            {brand
              ? 'Mengganti nama berlaku untuk semua item merk ini.'
              : 'Merk baru langsung dapat dipilih.'}
          </FormDialogDescription>
        </FormDialogHeader>
        {open ? (
          <BrandFormBody
            key={brand?.id ?? 'new'}
            brand={brand}
            businessUnits={businessUnits}
            onSave={onSave}
            onCreateBusinessUnit={onCreateBusinessUnit}
            openBusinessUnitHref={openBusinessUnitHref}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
