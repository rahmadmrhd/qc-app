import type {
  BrandDto,
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FieldError } from '@/components/field-error';
import { FormHeader } from '@/components/form-header';
import { LinkField, LinkMultiField, type LinkOption } from '@/components/link-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BusinessUnitFormDialog } from '@/modules/access/components/business-unit-form-dialog';
import {
  BrandFormDialog,
  type BrandSaveInput,
  type BrandSaveResult,
  brandSaveFailure,
} from '@/modules/brand/components/brand-form-dialog';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { defaultBusinessUnitIds } from '../lib/default-business-units';
import { errorText } from '../lib/row-error';
import type { ItemFieldErrors, ItemFormInput, ItemFormOutput } from '../schemas';
import { itemFormSchema } from '../schemas';
import { AccessoryListField } from './accessory-list-field';
import { ImageGalleryField } from './image-gallery-field';
import { StickerListField } from './sticker-list-field';

export interface ItemFormProps {
  /** Judul halaman, tampil di bar sticky bersama tombol aksi. */
  title: string;
  /** Merk yang sudah ada (pilihan field Merk). */
  brands?: readonly BrandDto[];
  /** Semua BU (nama, kode, status) untuk label chip dan pilihan. */
  businessUnits?: readonly BusinessUnitOptionDto[];
  /** Id BU yang boleh diisi user (level `edit` ke atas); BU nonaktif tetap tidak ditawarkan. */
  editableBusinessUnitIds?: readonly string[];
  /**
   * Membuat merk baru (nama + BU bawaan) dari dialog "Tambah merk"; hanya disediakan bila user boleh membuat merk.
   * Melempar galat bila gagal (pesannya tampil di dialog).
   */
  onCreateBrand?: (input: BrandSaveInput) => Promise<BrandDto>;
  /**
   * Membuat BU baru dari dialog "Tambah BU" pada field BU; hanya disediakan bila user boleh mengelola BU
   * (`access: manage`). BU baru langsung terpilih. Melempar galat bila gagal.
   */
  onCreateBusinessUnit?: (input: SaveBusinessUnitInput) => Promise<BusinessUnitDto>;
  /** Tautan ke halaman lihat merk/BU (tab baru); tidak disediakan bila user tak berhak melihatnya, sehingga tombolnya hilang. */
  openBrandHref?: (id: string) => string | null;
  openBusinessUnitHref?: (id: string) => string | null;
  defaultValues: ItemFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. merk+tipe sudah dipakai). */
  fieldErrors?: ItemFieldErrors;
  onSubmit: (values: ItemFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

const BRAND_OPTION_LIMIT = 30;

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${bu.name} (${bu.code})${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ItemForm({
  brands = [],
  businessUnits = [],
  editableBusinessUnitIds = [],
  onCreateBrand,
  onCreateBusinessUnit,
  openBrandHref,
  openBusinessUnitHref,
  defaultValues,
  title,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  // Galat server pada sebuah field hilang begitu user mengoreksi field itu (dan kembali saat ada galat baru).
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset setiap kali galat server yang baru datang
  useEffect(() => setCleared(new Set()), [fieldErrors]);
  const serverError = (key: keyof ItemFieldErrors) =>
    cleared.has(key) ? undefined : fieldErrors?.[key];
  const clear = (key: keyof ItemFieldErrors) =>
    setCleared((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));
  const form = useForm({
    defaultValues,
    validators: { onSubmit: itemFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(itemFormSchema.parse(value));
    },
  });

  // Merk yang baru dibuat lewat dialog langsung bisa dipilih, sebelum daftar merk dari server dimuat ulang.
  const [createdBrands, setCreatedBrands] = useState<readonly BrandDto[]>([]);
  const [brandDialogOpen, setBrandDialogOpen] = useState(false);
  const [brandTerm, setBrandTerm] = useState('');
  const allBrands = [...brands, ...createdBrands.filter((c) => !brands.some((b) => b.id === c.id))];
  const brandById = (id: string) => allBrands.find((brand) => brand.id === id);
  const brandLabel = (id: string) => {
    const brand = brandById(id);
    if (!brand) return undefined;
    return brand.status === 'inactive' ? `${brand.name} — nonaktif` : brand.name;
  };
  const brandTermKey = normalizeKey(brandTerm);
  const brandCandidates = allBrands.filter(
    (brand) =>
      (brand.status === 'active' || brand.id === defaultValues.brandId) &&
      (brandTermKey === '' || normalizeKey(brand.name).includes(brandTermKey)),
  );
  const brandOptions: LinkOption[] = brandCandidates.slice(0, BRAND_OPTION_LIMIT).map((brand) => ({
    id: brand.id,
    label: brandLabel(brand.id) ?? brand.name,
  }));

  // BU yang baru dibuat lewat dialog langsung bisa dilabeli, sebelum daftar BU dari server dimuat ulang.
  const [createdBus, setCreatedBus] = useState<readonly BusinessUnitOptionDto[]>([]);
  const [buDialogOpen, setBuDialogOpen] = useState(false);
  const buById = new Map(
    [...businessUnits, ...createdBus.filter((c) => !businessUnits.some((b) => b.id === c.id))].map(
      (bu) => [bu.id, bu],
    ),
  );
  const editable = new Set(editableBusinessUnitIds);
  const addableBus = businessUnits.filter((bu) => bu.status === 'active' && editable.has(bu.id));
  const addableBuIds = addableBus.map((bu) => bu.id);
  const [buTerm, setBuTerm] = useState('');
  const buTermKey = normalizeKey(buTerm);
  const buOptions: LinkOption[] = addableBus
    .filter(
      (bu) =>
        buTermKey === '' ||
        normalizeKey(bu.name).includes(buTermKey) ||
        normalizeKey(bu.code).includes(buTermKey),
    )
    .map((bu) => ({ id: bu.id, label: buLabel(bu) }));
  // Pengisian otomatis dari BU bawaan merk hanya selama BU belum dipilih/diubah manual; item yang sudah punya BU
  // (mode ubah) dianggap sudah dipilih, jadi mengganti merk tidak menimpanya.
  const buTouched = useRef(defaultValues.businessUnitIds.length > 0);

  async function handleCreateBrand(input: BrandSaveInput): Promise<BrandSaveResult> {
    if (!onCreateBrand) return 'Anda tidak berhak membuat merk';
    try {
      const brand = await onCreateBrand(input);
      setCreatedBrands((previous) => [...previous, brand]);
      selectBrand(brand.id, brand);
      return null;
    } catch (error) {
      return brandSaveFailure(error);
    }
  }

  function selectBrand(id: string | null, known?: BrandDto) {
    form.setFieldValue('brandId', id ?? '');
    clear('brandId');
    if (id !== null && !buTouched.current) {
      form.setFieldValue(
        'businessUnitIds',
        defaultBusinessUnitIds(known ?? brandById(id), addableBuIds),
      );
      clear('businessUnitIds');
    }
  }

  return (
    <>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <FormHeader
              title={title}
              onCancel={onCancel}
              submitting={isSubmitting}
              busyText="Menyimpan item…"
            />
          )}
        </form.Subscribe>
        <Section title="Informasi dasar">
          <form.Field name="brandId">
            {(field) => (
              <LinkField
                id="item-brand"
                label="Merk"
                placeholder="Pilih merk"
                value={field.state.value === '' ? null : field.state.value}
                labelOf={brandLabel}
                options={brandOptions}
                hasMore={brandCandidates.length > BRAND_OPTION_LIMIT}
                onSearchChange={setBrandTerm}
                onChange={(id) => {
                  selectBrand(id);
                  field.handleBlur();
                }}
                onCreate={onCreateBrand ? () => setBrandDialogOpen(true) : undefined}
                openHref={openBrandHref}
                error={errorText([...field.state.meta.errors, serverError('brandId')])}
              />
            )}
          </form.Field>
          <form.Field name="businessUnitIds">
            {(field) => (
              <div className="space-y-1.5">
                <LinkMultiField
                  id="item-business-units"
                  label="BU"
                  placeholder="Pilih BU"
                  value={field.state.value}
                  labelOf={(id) => {
                    const bu = buById.get(id);
                    return bu ? buLabel(bu) : id;
                  }}
                  options={buOptions}
                  onSearchChange={setBuTerm}
                  onCreate={onCreateBusinessUnit ? () => setBuDialogOpen(true) : undefined}
                  openHref={openBusinessUnitHref}
                  onChange={(ids) => {
                    buTouched.current = true;
                    field.handleChange(ids);
                    clear('businessUnitIds');
                  }}
                  error={errorText([...field.state.meta.errors, serverError('businessUnitIds')])}
                />
                {addableBus.length === 0 && field.state.value.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Belum ada BU yang dapat Anda isi; hubungi admin.
                  </p>
                ) : null}
              </div>
            )}
          </form.Field>
          <form.Field name="model">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="item-model">Tipe</Label>
                <Input
                  id="item-model"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    clear('model');
                  }}
                />
                <FieldError errors={[...field.state.meta.errors, serverError('model')]} />
              </div>
            )}
          </form.Field>
          <form.Field name="isCountryLock">
            {(field) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="item-country-lock"
                  checked={field.state.value}
                  onCheckedChange={(next) => field.handleChange(next === true)}
                />
                <Label htmlFor="item-country-lock" className="font-normal">
                  Country lock (wajib)
                </Label>
              </div>
            )}
          </form.Field>
          <form.Field name="aliasesText">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="item-aliases">Nama lain</Label>
                <Textarea
                  id="item-aliases"
                  rows={3}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    clear('aliases');
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Satu per baris. Dipakai untuk pencarian dan saran saat mengetik tipe.
                </p>
                <FieldError errors={[...field.state.meta.errors, serverError('aliases')]} />
              </div>
            )}
          </form.Field>
        </Section>

        <Section
          title="Gambar lampiran"
          hint="Maksimal 10 gambar; urutan pertama menjadi gambar utama."
        >
          <form.Field name="attachments">
            {(field) => (
              <div className="space-y-1.5">
                <form.Subscribe
                  selector={(state) =>
                    `${brandById(state.values.brandId)?.name ?? ''} ${state.values.model}`.trim()
                  }
                >
                  {(itemLabel) => (
                    <ImageGalleryField
                      value={field.state.value}
                      itemLabel={itemLabel}
                      onChange={(ids) => {
                        field.handleChange(ids);
                        clear('attachments');
                      }}
                    />
                  )}
                </form.Subscribe>
                <FieldError errors={[...field.state.meta.errors, serverError('attachments')]} />
              </div>
            )}
          </form.Field>
        </Section>

        <Section title="Stiker yang perlu ditempel" hint="QC memakai daftar ini sebagai acuan.">
          <form.Field name="stickers">
            {(field) => (
              <div className="space-y-1.5">
                <StickerListField
                  value={field.state.value}
                  error={errorText([...field.state.meta.errors, serverError('stickers')])}
                  onChange={(rows) => {
                    field.handleChange(rows);
                    clear('stickers');
                  }}
                />
                <FieldError
                  stacked
                  errors={[...field.state.meta.errors, serverError('stickers')]}
                />
              </div>
            )}
          </form.Field>
        </Section>

        <Section title="Kelengkapan aksesoris" hint="Jumlah per unit.">
          <form.Field name="accessories">
            {(field) => (
              <div className="space-y-1.5">
                <AccessoryListField
                  value={field.state.value}
                  error={errorText([...field.state.meta.errors, serverError('accessories')])}
                  onChange={(rows) => {
                    field.handleChange(rows);
                    clear('accessories');
                  }}
                />
                <FieldError
                  stacked
                  errors={[...field.state.meta.errors, serverError('accessories')]}
                />
              </div>
            )}
          </form.Field>
        </Section>

        <Section title="Detail dan spesifikasi">
          <form.Field name="detail">
            {(field) => (
              <div className="space-y-1.5">
                <span id="item-detail-label" className="sr-only">
                  Detail dan spesifikasi
                </span>
                <WysiwygEditor
                  id="item-detail"
                  labelledBy="item-detail-label"
                  value={field.state.value}
                  onChange={(text) => {
                    field.handleChange(text);
                    clear('detail');
                  }}
                />
                <FieldError errors={[...field.state.meta.errors, serverError('detail')]} />
              </div>
            )}
          </form.Field>
        </Section>

        {submitError ? (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : null}
      </form>
      {onCreateBusinessUnit ? (
        <BusinessUnitFormDialog
          open={buDialogOpen}
          onOpenChange={setBuDialogOpen}
          onSave={async (input) => {
            const bu = await onCreateBusinessUnit(input);
            setCreatedBus((previous) => [...previous, bu]);
            buTouched.current = true;
            const current = form.getFieldValue('businessUnitIds');
            if (!current.includes(bu.id))
              form.setFieldValue('businessUnitIds', [...current, bu.id]);
            clear('businessUnitIds');
            return bu;
          }}
        />
      ) : null}
      {onCreateBrand ? (
        <BrandFormDialog
          open={brandDialogOpen}
          onOpenChange={setBrandDialogOpen}
          businessUnits={businessUnits}
          onSave={handleCreateBrand}
          onCreateBusinessUnit={onCreateBusinessUnit}
          openBusinessUnitHref={openBusinessUnitHref}
        />
      ) : null}
    </>
  );
}
