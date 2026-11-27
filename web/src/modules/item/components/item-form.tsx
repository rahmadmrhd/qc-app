import { formatBuLabel } from '@shared/business-units';
import type {
  BrandDto,
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import { firmwareOptionsFor, isValidFirmware } from '@shared/firmware';
import { normalizeKey } from '@shared/items';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { useForm, useStore } from '@tanstack/react-form';
import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { LinkField, LinkMultiField, type LinkOption } from '@/components/link-field';
import { FormSection } from '@/components/page/form-section';
import { type FormTab, FormTabs } from '@/components/page/form-tabs';
import { Select } from '@/components/select';
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
import {
  StickerFormDialog,
  type StickerFormDialogProps,
  type StickerSaveInput,
  type StickerSaveResult,
  stickerSaveFailure,
} from '@/modules/sticker/components/sticker-form-dialog';
import type { StickerTypeSaveInput } from '@/modules/sticker/components/sticker-type-form-dialog';
import { defaultBusinessUnitIds } from '../lib/default-business-units';
import { errorText, errorTexts } from '../lib/row-error';
import type { ItemFieldErrors, ItemFormInput, ItemFormOutput } from '../schemas';
import { itemFormSchema } from '../schemas';
import { AccessoryListField } from './accessory-list-field';
import { ImageGalleryField } from './image-gallery-field';
import { type GuideInfo, StickerInstructionsField } from './sticker-instructions-field';

export const ITEM_FORM_TABS = ['detail', 'gambar', 'instruksi', 'spesifikasi'] as const;
export type ItemFormTab = (typeof ITEM_FORM_TABS)[number];

const TAB_LABEL: Record<ItemFormTab, string> = {
  detail: 'Detail',
  gambar: 'Gambar',
  instruksi: 'Instruksi Stiker',
  spesifikasi: 'Spesifikasi',
};

/** Field form milik tiap tab (dasar titik galat dan pembukaan tab bergalat). */
const TAB_FIELDS: Record<ItemFormTab, readonly (keyof ItemFieldErrors)[]> = {
  detail: ['brandId', 'businessUnitIds', 'model', 'firmware', 'proofMin', 'aliases', 'accessories'],
  gambar: ['attachments'],
  instruksi: ['stickerPhotos'],
  spesifikasi: ['detail'],
};

export interface ItemFormProps {
  /** Id elemen `<form>`: tombol Simpan berada di luar form (bar halaman / footer dialog) dan memakai `form={formId}`. */
  formId: string;
  /** Tab aktif terkendali; tanpa ini tab dikelola sendiri. */
  activeTab?: ItemFormTab;
  onActiveTabChange?: (tab: ItemFormTab) => void;
  /**
   * Dipanggil saat ada gambar (galeri, foto instruksi, atau gambar di Detail) yang masih diunggah (true) dan saat
   * semuanya selesai (false); pembungkus menahan tombol Simpan (`submitDisabled`) selama true.
   */
  onBusyChange?: (busy: boolean) => void;
  /** Tab yang memuat galat (validasi atau server), diteruskan ke pembungkus. */
  onTabErrorsChange?: (errors: Record<ItemFormTab, boolean>) => void;
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
  /** Katalog stiker dan jenis (pilihan sasaran penanda instruksi stiker). */
  stickers?: readonly StickerDto[];
  stickerTypes?: readonly StickerTypeDto[];
  /** Gambar pustaka yang dikenal untuk foto instruksi item yang diubah (nama dan dimensi). */
  guides?: readonly GuideInfo[];
  /** Item yang diubah (bukan sumber salin penanda bagi dirinya sendiri). */
  itemId?: string;
  /**
   * Membuat stiker baru dari dialog "Tambah stiker" pada penanda; hanya disediakan bila user berhak (`sticker: edit`).
   * Stiker baru langsung terpilih pada penanda itu. Melempar galat bila gagal (tampil di dialog).
   */
  onCreateSticker?: (input: StickerSaveInput) => Promise<StickerDto>;
  /**
   * Membuat jenis stiker baru dari baris "Tambah Jenis" DI DALAM dialog tambah stiker (satu-satunya jalur; penanda tak
   * punya pintu pembuatan jenis sendiri). Jenis baru langsung dikenal daftar form.
   */
  onCreateStickerType?: (input: StickerTypeSaveInput) => Promise<StickerTypeDto>;
  /** Minimum stok bawaan di dialog Tambah Jenis hanya dapat diisi pemegang `sticker: manage`. */
  canSetStickerTypeDefaultMin?: boolean;
  openStickerTypeHref?: StickerFormDialogProps['openStickerTypeHref'];
  /** Lokasi tempat user boleh mencatat stok masuk (bagian "Stok awal" stiker baru). */
  stockLocations?: StickerFormDialogProps['stockLocations'];
  defaultValues: ItemFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. merk+tipe sudah dipakai). */
  fieldErrors?: ItemFieldErrors;
  onSubmit: (values: ItemFormOutput) => Promise<unknown>;
}

const BRAND_OPTION_LIMIT = 30;

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${formatBuLabel(bu)}${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

export function ItemForm({
  formId,
  activeTab,
  onActiveTabChange,
  onTabErrorsChange,
  brands = [],
  businessUnits = [],
  editableBusinessUnitIds = [],
  onCreateBrand,
  onCreateBusinessUnit,
  openBrandHref,
  openBusinessUnitHref,
  stickers = [],
  stickerTypes = [],
  guides,
  itemId,
  onCreateSticker,
  onCreateStickerType,
  canSetStickerTypeDefaultMin,
  openStickerTypeHref,
  stockLocations,
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onBusyChange,
}: ItemFormProps) {
  // Gambar galeri atau foto instruksi yang masih diunggah: Simpan ditahan agar tidak ada yang tertinggal.
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);
  // Gambar yang disisipkan ke Detail dan spesifikasi masih diunggah.
  const [detailBusy, setDetailBusy] = useState(false);
  const anyBusy = galleryBusy || photosBusy || detailBusy;
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya `anyBusy` yang melaporkan; `onBusyChange` boleh berganti identitas
  useEffect(() => onBusyChange?.(anyBusy), [anyBusy]);
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
  useUnsavedChanges(useStore(form.store, (state) => state.isDirty && !state.isSubmitSuccessful));

  // Merk yang baru dibuat lewat dialog langsung bisa dipilih, sebelum daftar merk dari server dimuat ulang.
  const [createdBrands, setCreatedBrands] = useState<readonly BrandDto[]>([]);
  const [brandDialogOpen, setBrandDialogOpen] = useState(false);
  const [brandTerm, setBrandTerm] = useState('');
  const allBrands = [...brands, ...createdBrands.filter((c) => !brands.some((b) => b.id === c.id))];
  const brandById = (id: string) => allBrands.find((brand) => brand.id === id);
  const brandLabel = (id: string) => {
    const brand = brandById(id);
    if (!brand) return undefined;
    if (brand.deleted) return `${brand.name} — Terhapus`;
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

  // Stiker/jenis yang baru dibuat lewat dialog langsung bisa dipilih, sebelum katalog dari server dimuat ulang.
  const [createdStickers, setCreatedStickers] = useState<readonly StickerDto[]>([]);
  const [createdTypes, setCreatedTypes] = useState<readonly StickerTypeDto[]>([]);
  const [stickerDialogOpen, setStickerDialogOpen] = useState(false);
  // Penanda yang meminta stiker baru: dipanggil dengan hasilnya agar langsung terpilih di penanda itu.
  const stickerCreated = useRef<((sticker: StickerDto) => void) | null>(null);
  const allStickers = [
    ...stickers,
    ...createdStickers.filter((c) => !stickers.some((sticker) => sticker.id === c.id)),
  ];
  const allTypes = [
    ...stickerTypes,
    ...createdTypes.filter((c) => !stickerTypes.some((type) => type.id === c.id)),
  ];

  async function handleCreateSticker(input: StickerSaveInput): Promise<StickerSaveResult> {
    if (!onCreateSticker) return 'Anda tidak berhak membuat stiker';
    try {
      const sticker = await onCreateSticker(input);
      setCreatedStickers((previous) => [...previous, sticker]);
      stickerCreated.current?.(sticker);
      return null;
    } catch (error) {
      return stickerSaveFailure(error);
    }
  }

  // Jenis dibuat dari dalam dialog stiker (baris "Tambah Jenis" di field Jenis): dialog menampilkan galatnya sendiri,
  // jadi cukup meneruskan hasilnya dan menaruhnya di daftar agar langsung dikenal.
  async function handleCreateStickerType(input: StickerTypeSaveInput): Promise<StickerTypeDto> {
    if (!onCreateStickerType) throw new Error('Anda tidak berhak membuat jenis stiker');
    const type = await onCreateStickerType(input);
    setCreatedTypes((previous) => [...previous, type]);
    return type;
  }

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
    // Kode firmware hanya berlaku untuk merk tertentu: kosongkan bila tak berlaku bagi merk baru.
    const brandName = id === null ? '' : (known ?? brandById(id))?.name;
    if (!isValidFirmware(brandName ?? '', form.getFieldValue('firmware'))) {
      form.setFieldValue('firmware', '');
      clear('firmware');
    }
    if (id !== null && !buTouched.current) {
      form.setFieldValue(
        'businessUnitIds',
        defaultBusinessUnitIds(known ?? brandById(id), addableBuIds),
      );
      clear('businessUnitIds');
    }
  }

  // Tab aktif: terkendali bila pembungkus memberi `activeTab`, selain itu lokal.
  const [localTab, setLocalTab] = useState<ItemFormTab>('detail');
  const tab = activeTab ?? localTab;
  const selectTab = (next: ItemFormTab) => {
    setLocalTab(next);
    onActiveTabChange?.(next);
  };
  // Titik galat per tab: galat validasi field (setelah submit) atau galat server yang belum dikoreksi.
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const attempts = useStore(form.store, (state) => state.submissionAttempts);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const tabErrors = Object.fromEntries(
    ITEM_FORM_TABS.map((id) => [
      id,
      TAB_FIELDS[id].some(
        (key) =>
          ((fieldMeta as Record<string, { errors?: unknown[] } | undefined>)[key]?.errors?.length ??
            0) > 0 || serverError(key) !== undefined,
      ) ||
        (id === 'detail' &&
          (['isCountryLock', 'proofRequired', 'aliasesText'] as const).some(
            (key) => (fieldMeta[key]?.errors?.length ?? 0) > 0,
          )),
    ]),
  ) as Record<ItemFormTab, boolean>;
  const tabErrorsKey = ITEM_FORM_TABS.map((id) => (tabErrors[id] ? '1' : '0')).join('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: dilaporkan hanya saat himpunan tab bergalat berubah
  useEffect(() => onTabErrorsChange?.(tabErrors), [tabErrorsKey]);
  // Simpan gagal validasi: buka tab bergalat pertama (sekali per percobaan simpan).
  const handledAttempt = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dijalankan saat percobaan simpan selesai
  useEffect(() => {
    if (attempts === 0 || submitting || handledAttempt.current === attempts) return;
    handledAttempt.current = attempts;
    const first = ITEM_FORM_TABS.find((id) => tabErrors[id]);
    if (first) selectTab(first);
  }, [attempts, submitting]);
  // Galat dari server: buka tab pertama yang memuatnya.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat galat server yang baru datang
  useEffect(() => {
    const first = ITEM_FORM_TABS.find((id) => TAB_FIELDS[id].some((key) => fieldErrors?.[key]));
    if (first) selectTab(first);
  }, [fieldErrors]);

  const detailTab = (
    <div className="space-y-6">
      <FormSection columns={1} title="Informasi dasar">
        <form.Field name="brandId">
          {(field) => (
            <LinkField
              id="item-brand"
              label="Merk"
              required
              placeholder="Pilih merk"
              value={field.state.value === '' ? null : field.state.value}
              labelOf={brandLabel}
              options={brandOptions}
              hasMore={brandCandidates.length > BRAND_OPTION_LIMIT}
              onSearchChange={setBrandTerm}
              searchDebounceMs={0}
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
                required
                placeholder="Pilih BU"
                value={field.state.value}
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
              <Label htmlFor="item-model" required>
                Tipe
              </Label>
              <Input
                id="item-model"
                aria-required="true"
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
                onCheckedChange={(next) => {
                  field.handleChange(next === true);
                  if (next !== true) {
                    form.setFieldValue('firmware', '');
                    clear('firmware');
                  }
                }}
              />
              <Label htmlFor="item-country-lock" className="font-normal">
                Country lock (wajib)
              </Label>
            </div>
          )}
        </form.Field>
        <form.Field name="proofRequired">
          {(field) => (
            <div className="flex items-center gap-2">
              <Checkbox
                id="item-proof-required"
                checked={field.state.value}
                onCheckedChange={(next) => {
                  field.handleChange(next === true);
                  if (next !== true) form.setFieldValue('proofMin', 1);
                  clear('proofMin');
                }}
              />
              <Label htmlFor="item-proof-required" className="font-normal">
                Wajib foto bukti
              </Label>
            </div>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.proofRequired}>
          {(required) =>
            required ? (
              <form.Field name="proofMin">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor="item-proof-min" required>
                      Minimum foto
                    </Label>
                    <Input
                      id="item-proof-min"
                      aria-required="true"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={SERIAL_PROOF_LIMITS.perEntryMax}
                      step={1}
                      className="w-28"
                      value={Number.isNaN(field.state.value) ? '' : field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(
                          event.target.value === '' ? Number.NaN : Number(event.target.value),
                        );
                        clear('proofMin');
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Saat mencatat Serial Number, item ini baru bisa disimpan kalau fotonya cukup
                      (1–
                      {SERIAL_PROOF_LIMITS.perEntryMax}).
                    </p>
                    <FieldError errors={[...field.state.meta.errors, serverError('proofMin')]} />
                  </div>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
        <form.Subscribe
          selector={(state) => ({
            lock: state.values.isCountryLock,
            brandId: state.values.brandId,
          })}
        >
          {({ lock, brandId }) => {
            const options = lock ? firmwareOptionsFor(brandById(brandId)?.name ?? '') : [];
            if (!lock) return null;
            return (
              <form.Field name="firmware">
                {(field) => (
                  <div className="space-y-1.5">
                    <Select
                      id="item-firmware"
                      label="Firmware"
                      placeholder={
                        options.length > 0
                          ? 'Pilih firmware'
                          : 'Merk ini tak punya firmware Country lock'
                      }
                      value={field.state.value}
                      options={options.map((option) => ({
                        value: option.code,
                        label: option.label,
                      }))}
                      onValueChange={(value) => {
                        field.handleChange(value);
                        clear('firmware');
                      }}
                      clearable
                      disabled={options.length === 0}
                    />
                    <p className="text-xs text-muted-foreground">
                      Dipakai aplikasi desktop untuk memilih skrip Country Lock otomatis.
                    </p>
                    <FieldError errors={[...field.state.meta.errors, serverError('firmware')]} />
                  </div>
                )}
              </form.Field>
            );
          }}
        </form.Subscribe>
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
      </FormSection>

      <FormSection columns={1} title="Kelengkapan aksesoris" description="Jumlah per unit.">
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
      </FormSection>
    </div>
  );
  const galleryTab = (
    <div className="space-y-6">
      <FormSection
        columns={1}
        title="Gambar lampiran"
        description="Maksimal 10 gambar; urutan pertama menjadi gambar utama."
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
                    onBusyChange={setGalleryBusy}
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
      </FormSection>
    </div>
  );
  const instructionTab = (
    <div className="space-y-6">
      <FormSection
        columns={1}
        title="Instruksi stiker"
        description="Foto dari pustaka gambar dengan penanda posisi stiker; QC memakainya sebagai acuan penempelan."
      >
        <form.Field name="stickerPhotos">
          {(field) => (
            <form.Subscribe selector={(state) => state.values.businessUnitIds}>
              {(selectedBuIds) => (
                <StickerInstructionsField
                  value={field.state.value}
                  onChange={(photos) => {
                    field.handleChange(photos);
                    clear('stickerPhotos');
                  }}
                  businessUnits={selectedBuIds.map((id) => {
                    const bu = buById.get(id);
                    return { id, label: bu ? buLabel(bu) : id };
                  })}
                  stickers={allStickers}
                  types={allTypes}
                  knownGuides={guides ?? []}
                  currentItemId={itemId}
                  onBusyChange={setPhotosBusy}
                  errors={errorTexts([...field.state.meta.errors, serverError('stickerPhotos')])}
                  {...(onCreateSticker
                    ? {
                        onCreateSticker: (created: (sticker: StickerDto) => void) => {
                          stickerCreated.current = created;
                          setStickerDialogOpen(true);
                        },
                      }
                    : {})}
                />
              )}
            </form.Subscribe>
          )}
        </form.Field>
      </FormSection>
    </div>
  );
  const specTab = (
    <div className="space-y-6">
      <FormSection columns={1} title="Detail dan spesifikasi">
        <form.Field name="detail">
          {(field) => (
            <div className="space-y-1.5">
              <span id="item-detail-label" className="sr-only">
                Detail dan spesifikasi
              </span>
              <WysiwygEditor
                id="item-detail"
                labelledBy="item-detail-label"
                onBusyChange={setDetailBusy}
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
      </FormSection>
    </div>
  );

  const tabs: FormTab[] = ITEM_FORM_TABS.map((id) => ({
    id,
    label: TAB_LABEL[id],
    hasError: tabErrors[id],
    content: {
      detail: detailTab,
      gambar: galleryTab,
      instruksi: instructionTab,
      spesifikasi: specTab,
    }[id],
  }));

  return (
    <>
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Form dialog bersarang di dalam form lain lewat portal React: jangan biarkan submit naik ke induk.
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FormTabs tabs={tabs} value={tab} onValueChange={(id) => selectTab(id as ItemFormTab)} />
        {submitError ? (
          <p role="alert" className="text-sm text-destructive-text">
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
      {onCreateSticker ? (
        <StickerFormDialog
          open={stickerDialogOpen}
          onOpenChange={setStickerDialogOpen}
          types={allTypes}
          businessUnits={businessUnits}
          onSave={handleCreateSticker}
          onCreateType={onCreateStickerType ? handleCreateStickerType : undefined}
          onCreateBusinessUnit={onCreateBusinessUnit}
          openBusinessUnitHref={openBusinessUnitHref}
          openStickerTypeHref={openStickerTypeHref}
          stockLocations={stockLocations}
          canSetTypeDefaultMin={canSetStickerTypeDefaultMin}
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
