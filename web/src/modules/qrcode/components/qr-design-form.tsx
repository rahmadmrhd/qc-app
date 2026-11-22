import type { BusinessUnitOptionDto, QrDocumentDto, QrPresetDto } from '@shared/contract';
import { manualBookNameFromTypes } from '@shared/manual-book';
import {
  parseDriveFileId,
  QR_FRAME_KEYS,
  QR_FRAME_RANGES,
  QR_LAYOUT_KEYS,
  QR_LAYOUT_RANGES,
  QR_LIMITS,
  qrContentHash,
  qrPresetDeviations,
} from '@shared/qrcode';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { LinkField } from '@/components/link-field';
import { type FormTab, FormTabs } from '@/components/page/form-tabs';
import { Select } from '@/components/select';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { useFileUrl } from '@/modules/files/queries';
import { ItemFormDialog } from '@/modules/item/components/item-form-dialog';
import { limitDocumentName } from '../lib/document-name';
import { businessUnitOptions, presetOptions } from '../lib/preset-options';
import { useCloneQrPdf, useUploadQrPdf } from '../queries';
import type { PresetApplyParts, QrEditContext, QrFormInput, QrFormOutput } from '../schemas';
import {
  frameRangeMessage,
  layoutRangeMessage,
  presetPatch,
  qrDesignFormSchema,
  qrPresetFormSchema,
  toNewDesignFromPreset,
} from '../schemas';
import { ApplyPresetDialog } from './apply-preset-dialog';
import { ExportChangeWarning } from './export-change-warning';
import { ItemPicker, type PickedItem } from './item-picker';
import { LabelPreview } from './label-preview';
import type { LabelStatus } from './label-status-alerts';
import { LabelStatusAlerts } from './label-status-alerts';
import { LogoPicker } from './logo-picker';
import { PdfSourceField } from './pdf-source-field';
import { PresetDeviationBanner } from './preset-deviation-banner';
import { QrPresetFormDialog } from './qr-preset-form-dialog';
import { SheetPreviewDialog } from './sheet-preview-dialog';
import { TextStyleToolbar } from './text-style-toolbar';

/**
 * Tab form QR: `detail` (Item Manual Book, konfigurasi default, nama, dan Sumber link; B5 2026-11-22 menggabungkan tab
 * `item` dan `sumber`), `label`, `logo` (Logo dan Bingkai), `ukuran`.
 */
export const QR_FORM_TABS = ['detail', 'label', 'logo', 'ukuran'] as const;
export type QrFormTab = (typeof QR_FORM_TABS)[number];

const TAB_LABEL: Record<QrFormTab, string> = {
  detail: 'Detail',
  label: 'Isi label',
  logo: 'Logo dan bingkai',
  ukuran: 'Ukuran',
};

/**
 * Field form milik tiap tab (dasar titik galat dan pembukaan tab bergalat). Mode `defaults` tak punya tab `detail`:
 * nama konfigurasi default, BU, dan penempatan nama berada di tab `label`.
 */
function tabOfField(field: string, isDefaults: boolean): QrFormTab {
  switch (field) {
    case 'itemIds':
    case 'presetId':
      return 'detail';
    case 'name':
      return isDefaults ? 'label' : 'detail';
    case 'buId':
    case 'namePlacement':
    case 'title':
    case 'subtitle':
    case 'footer':
      return 'label';
    case 'documentId':
    case 'link':
      return 'detail';
    case 'logoFileId':
    case 'defaultLogoId':
    case 'style':
      return 'logo';
    default:
      return 'ukuran';
  }
}

/** Keadaan form yang dibaca pembungkus (bar halaman atau footer dialog) untuk tombol di luar `<form>`. */
export interface QrFormUiState {
  /** Simpan sedang berjalan. */
  submitting: boolean;
  /** Simpan ditahan: belum siap (item/preset), unggahan PDF atau logo berjalan/gagal, atau salinan Drive berjalan. */
  blocked: boolean;
  /** Isi tidak muat di kanvas 3 × 3 cm: ekspor ditahan. */
  overflow: boolean;
}

export interface QrDesignFormProps {
  /** Id elemen `<form>`: tombol Simpan berada di luar form (bar halaman / footer dialog) dan memakai `form={formId}`. */
  formId: string;
  /** Dilaporkan tiap keadaan di atas berubah; pembungkus memakainya untuk tombol Simpan (`submitDisabled`). */
  onUiState?: (state: QrFormUiState) => void;
  /** Tab aktif terkendali; tanpa ini tab dikelola sendiri. */
  activeTab?: QrFormTab;
  onActiveTabChange?: (tab: QrFormTab) => void;
  defaultValues: QrFormInput;
  /** PDF sumber yang sudah terpasang (saat ubah/duplikat). */
  initialDocument?: QrDocumentDto | null;
  /** `defaults`: konfigurasi default (tanpa sumber link dan ekspor; mengelola pustaka logo). */
  mode?: 'design' | 'defaults';
  /** Pustaka logo bersama yang dapat dipilih. */
  logoLibrary?: readonly string[];
  /**
   * QR baru (alur Manual Book): semua konfigurasi default. Pengguna memilih item dulu; preset ditarik otomatis
   * menurut BU item (satu BU = otomatis, lebih dari satu = pilih satu, tanpa preset BU = pilih mana saja atau tanpa
   * preset); isian lain baru tampil setelah itu. Kosongkan (undefined) untuk ubah/mode default.
   */
  presets?: readonly QrPresetDto[];
  /** Ubah: konteks konfigurasi yang diubah (item tergabung, penempatan nama, hash ekspor, mode lama). */
  edit?: QrEditContext;
  /** Tautan buka item pada pemilih item (`itemLinkAccess`). */
  openItemHref?: (id: string) => string | null;
  /** Boleh membuka View item terhapus (`itemLinkAccess(...).canOpenDeleted`); selain itu item terhapus tanpa tautan. */
  canOpenDeletedItem?: boolean;
  /** Tautan buka konfigurasi default pada pemilih preset (`qrPresetLinkAccess`); tanpa hak = tanpa tautan. */
  openPresetHref?: ((id: string) => string) | undefined;
  /** Boleh menambah konfigurasi default dari pemilih preset (`qrPresetLinkAccess(...).canCreate`): baris "Tambah preset". */
  canCreatePreset?: boolean;
  /** Boleh menambah item dari pemilih item (`itemLinkAccess(...).canCreate`): memunculkan baris "Tambah Item". */
  canCreateItem?: boolean;
  /** Ubah/duplikat: konfigurasi default yang dapat diterapkan ulang (tombol "Perbarui sesuai konfigurasi default"). */
  updatePresets?: readonly QrPresetDto[];
  /** Mode `defaults`: BU yang dapat dipilih sebagai pemilik preset. */
  businessUnits?: readonly BusinessUnitOptionDto[];
  /** Mode `defaults`: BU yang sudah punya preset lain (tampil nonaktif; satu preset per BU). */
  takenBuIds?: ReadonlySet<string>;
  submitError?: string | null;
  fieldErrors?: Readonly<Record<string, string | undefined>>;
  onSubmit: (values: QrFormOutput, options: QrSubmitOptions) => void | Promise<void>;
}

export interface QrSubmitOptions {
  /** Isi tidak muat di kanvas 3 × 3 cm menurut pratinjau saat disimpan (disimpan server sebagai flag). */
  overflow: boolean;
  /**
   * Setelah tersimpan, lanjut ke dialog konfirmasi ekspor. Dibaca dari tombol pengirim submit
   * (`data-export="true"` pada tombol "Simpan dan ekspor" di pembungkus), jadi tak pernah "bocor" ke simpan biasa.
   */
  thenExport: boolean;
}

/** Kunci ukuran font pada tata letak untuk tiap bagian teks (isiannya ada di bagian teks itu sendiri). */
const TEXT_SIZE_KEY = {
  title: 'titleSize',
  subtitle: 'subtitleSize',
  footer: 'footerSize',
} as const;
const TEXT_SIZE_KEYS: readonly string[] = Object.values(TEXT_SIZE_KEY);

/** Pilihan "Tanpa preset" pada pemilih preset (bukan id preset). */
const NO_PRESET = '__none__';

/** Hash isi label dari nilai form (link efektif: URL, atau URL berbagi PDF sumber) untuk membandingkan dengan ekspor. */
function labelHash(values: QrFormOutput, document: QrDocumentDto | null): string {
  return qrContentHash({
    linkSource: values.linkSource,
    link: values.linkSource === 'url' ? values.link : (document?.link ?? ''),
    title: values.title,
    subtitle: values.subtitle,
    footer: values.footer,
    logoFileId: values.logoFileId,
    layout: values.layout,
    style: values.style,
  });
}

function Section({
  title,
  children,
  'data-tour': dataTour,
}: {
  title: string;
  children: React.ReactNode;
  /** Penanda panduan interaktif; ditulis literal di pemanggil agar terbaca tes katalog. */
  'data-tour'?: string;
}) {
  return (
    <section data-tour={dataTour} className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function QrDesignForm({
  formId,
  onUiState,
  activeTab,
  onActiveTabChange,
  defaultValues,
  initialDocument = null,
  mode = 'design',
  logoLibrary = [],
  presets,
  updatePresets,
  edit,
  openItemHref,
  canOpenDeletedItem,
  canCreateItem = false,
  canCreatePreset = false,
  openPresetHref,
  businessUnits = [],
  takenBuIds,
  submitError,
  fieldErrors,
  onSubmit,
}: QrDesignFormProps) {
  const uploadPdf = useUploadQrPdf();
  const cloneQrPdf = useCloneQrPdf();
  const [document, setDocument] = useState<QrDocumentDto | null>(initialDocument);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [legacyCloning, setLegacyCloning] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [labelStatus, setLabelStatus] = useState<LabelStatus | null>(null);
  // Nilai terkini untuk handler simpan (menghindari closure basi): status tata letak dan mode simpan.
  const statusRef = useRef<LabelStatus | null>(null);
  statusRef.current = labelStatus;
  const exportAfterRef = useRef(false);
  const isDefaults = mode === 'defaults';
  const [applyOpen, setApplyOpen] = useState(false);
  const [chosenPreset, setChosenPreset] = useState('');
  const [presetTerm, setPresetTerm] = useState('');
  const [buTerm, setBuTerm] = useState('');
  // Alur Manual Book (QR baru atau ubah): item, preset, dan nama. Mode `defaults` dan form polos tanpa keduanya.
  const newFlow = !isDefaults && presets !== undefined;
  const manualBookFlow = !isDefaults && (presets !== undefined || edit !== undefined);
  const requireItems = newFlow || (edit !== undefined && !edit.legacy);
  const [selected, setSelected] = useState<PickedItem[]>(() =>
    (edit?.items ?? []).map((item) => ({ ...item, businessUnitIds: [] })),
  );
  const nameTouched = useRef(edit !== undefined);
  const [pendingSave, setPendingSave] = useState<{
    values: QrFormOutput;
    options: QrSubmitOptions;
  } | null>(null);

  // Preset yang berlaku pada QR baru: satu BU item = otomatis; lebih dari satu = pilihan pengguna; tanpa preset BU
  // itu = pilih mana saja atau tanpa preset (otomatis bila belum ada preset sama sekali).
  const itemBuIds = new Set(selected.flatMap((item) => item.businessUnitIds));
  const candidates = (presets ?? []).filter(
    (preset) => preset.buId !== '' && itemBuIds.has(preset.buId),
  );
  let effectivePreset = '';
  if (newFlow && selected.length > 0) {
    if (candidates.length === 1) effectivePreset = (candidates[0] as QrPresetDto).id;
    else if (candidates.length > 1) {
      effectivePreset = candidates.some((preset) => preset.id === chosenPreset) ? chosenPreset : '';
    } else if ((presets ?? []).length === 0) effectivePreset = NO_PRESET;
    else if (
      chosenPreset === NO_PRESET ||
      (presets ?? []).some((preset) => preset.id === chosenPreset)
    ) {
      effectivePreset = chosenPreset;
    }
  }
  const ready = !newFlow || effectivePreset !== '';
  const schema = (
    isDefaults ? qrPresetFormSchema : qrDesignFormSchema
  ) as typeof qrDesignFormSchema;
  const form = useForm({
    defaultValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const thenExport = exportAfterRef.current;
      exportAfterRef.current = false;
      const values = schema.parse(value);
      const options = { overflow: statusRef.current?.overflow ?? false, thenExport };
      // Konfigurasi yang sudah pernah diekspor dan labelnya berubah: peringatan akibat dulu (spek butir 10).
      if (edit?.exportedHash && labelHash(values, document) !== edit.exportedHash) {
        setPendingSave({ values, options });
        return;
      }
      await onSubmit(values, options);
    },
  });
  useUnsavedChanges(useStore(form.store, (state) => state.isDirty && !state.isSubmitSuccessful));

  const activePreset = presets?.find((preset) => preset.id === effectivePreset);
  const lockedPart = newFlow ? (activePreset?.namePlacement ?? '') : (edit?.namePlacement ?? '');
  const nameValue = useStore(form.store, (state) => state.values.name);

  // Nama otomatis dari tipe item (QR baru) selama belum diedit pengguna.
  const selectedModels = JSON.stringify(selected.map((item) => item.model));
  useEffect(() => {
    if (!newFlow || nameTouched.current) return;
    const models = JSON.parse(selectedModels) as string[];
    form.setFieldValue('name', manualBookNameFromTypes(models, QR_LIMITS.manualBookName));
  }, [newFlow, selectedModels, form]);

  // Isian dari preset yang berlaku (sekali per pergantian preset); "Tanpa preset" tidak mengubah isian.
  useEffect(() => {
    if (!newFlow) return;
    form.setFieldValue('presetId', effectivePreset === NO_PRESET ? '' : effectivePreset);
    const preset = presets?.find((item) => item.id === effectivePreset);
    if (!preset) return;
    const values = toNewDesignFromPreset(preset);
    form.setFieldValue('title', values.title);
    form.setFieldValue('subtitle', values.subtitle);
    form.setFieldValue('footer', values.footer);
    form.setFieldValue('logoFileId', values.logoFileId);
    form.setFieldValue('layout', values.layout);
    form.setFieldValue('style', values.style);
    if (preset.namePlacement !== '') {
      form.setFieldValue(preset.namePlacement, form.state.values.name);
    }
  }, [newFlow, effectivePreset, presets, form]);

  // Bagian label yang terkunci selalu sama dengan nama.
  useEffect(() => {
    if (lockedPart !== '') form.setFieldValue(lockedPart, nameValue);
  }, [lockedPart, nameValue, form]);

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  // "Tambah preset": hanya untuk BU item yang belum punya preset (satu preset per BU); tanpa BU seperti itu = tanpa baris.
  const businessUnitsQuery = useQuery({
    ...businessUnitOptionsQueryOptions(),
    enabled: newFlow && canCreatePreset,
  });
  const presetlessBus = (businessUnitsQuery.data ?? []).filter(
    (unit) =>
      unit.status === 'active' &&
      itemBuIds.has(unit.id) &&
      !(presets ?? []).some((preset) => preset.buId === unit.id),
  );
  const canAddPreset = newFlow && canCreatePreset && presetlessBus.length > 0;

  function changeItems(next: PickedItem[]) {
    setSelected(next);
    form.setFieldValue(
      'itemIds',
      next.map((item) => item.id),
    );
  }

  function applyPreset(preset: QrPresetDto, parts: PresetApplyParts) {
    const patch = presetPatch(preset, parts);
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      form.setFieldValue(key, patch[key] as never);
    }
    // Bagian label yang terkunci ke nama tidak boleh tertimpa isi preset (efek penguncian tak berjalan ulang di sini).
    if (lockedPart !== '') form.setFieldValue(lockedPart, form.state.values.name);
  }

  function applyDocument(next: QrDocumentDto) {
    setDocument(next);
    setLegacyError(null);
    form.setFieldValue('linkSource', 'pdf');
    form.setFieldValue('documentId', next.id);
  }

  async function cloneLegacy(link: string) {
    setLegacyError(null);
    setLegacyCloning(true);
    try {
      applyDocument(await cloneQrPdf.mutateAsync({ source: link }));
    } catch (caught) {
      setLegacyError(caught instanceof Error ? caught.message : 'Gagal menyalin PDF dari Drive');
    } finally {
      setLegacyCloning(false);
    }
  }

  const itemTab = (
    <div className="space-y-4">
      {manualBookFlow ? (
        <Section title="Item Manual Book" data-tour="qr-items">
          <form.Field
            name="itemIds"
            validators={{
              // Item yang tak terlihat tetap terpasang (spek 4a §3 butir 18): daftar terlihat boleh kosong.
              onSubmit: ({ value }) =>
                requireItems && value.length === 0 && (edit?.hiddenItemCount ?? 0) === 0
                  ? 'Pilih minimal satu item'
                  : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-1.5">
                <ItemPicker
                  selected={selected}
                  onChange={changeItems}
                  ownedIds={new Set((edit?.items ?? []).map((item) => item.id))}
                  openHref={openItemHref}
                  canOpenDeleted={canOpenDeletedItem}
                  onCreate={canCreateItem ? () => setItemDialogOpen(true) : undefined}
                  required={requireItems}
                />
                <p className="text-xs text-muted-foreground">
                  Item yang berbagi satu Manual Book. Item yang sudah tergabung ke Manual Book lain
                  harus dikeluarkan dulu dari sana.
                </p>
                {edit && edit.hiddenItemCount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {edit.hiddenItemCount} item lain tergabung di sini tetapi tidak terlihat oleh
                    Anda; tetap terpasang.
                  </p>
                ) : null}
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.itemIds]} />
              </div>
            )}
          </form.Field>
        </Section>
      ) : null}
      {newFlow && selected.length > 0 ? (
        <Section title="Konfigurasi default" data-tour="qr-preset">
          {candidates.length === 1 ? (
            <p className="text-sm">
              Memakai konfigurasi default BU item:{' '}
              <span className="font-medium">{(candidates[0] as QrPresetDto).name}</span> (otomatis).
              Isian di bawah terisi darinya dan dapat diubah.
            </p>
          ) : (presets ?? []).length === 0 && !canAddPreset ? (
            <p className="text-sm text-muted-foreground">
              Belum ada konfigurasi default; QR dibuat dengan nilai bawaan aplikasi.
            </p>
          ) : (
            <div className="space-y-1.5">
              <LinkField
                id="qr-preset"
                label="Pilih konfigurasi default"
                placeholder="Pilih konfigurasi default…"
                value={
                  chosenPreset === ''
                    ? (presets ?? []).length === 0
                      ? NO_PRESET
                      : null
                    : chosenPreset
                }
                labelOf={(id) =>
                  id === NO_PRESET
                    ? 'Tanpa preset'
                    : presets?.find((preset) => preset.id === id)?.name
                }
                options={[
                  ...presetOptions(
                    candidates.length > 1 ? candidates : (presets ?? []),
                    presetTerm,
                  ),
                  ...(candidates.length > 1
                    ? []
                    : [
                        {
                          id: NO_PRESET,
                          label: 'Tanpa preset',
                          description: 'Nilai bawaan aplikasi',
                        },
                      ]),
                ]}
                onSearchChange={setPresetTerm}
                searchDebounceMs={0}
                onChange={(id) => setChosenPreset(id ?? '')}
                onCreate={canAddPreset ? () => setPresetDialogOpen(true) : undefined}
                createLabel="preset"
                openHref={
                  openPresetHref
                    ? (id) => (id === NO_PRESET ? null : openPresetHref(id))
                    : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                {candidates.length > 1
                  ? 'Item berlainan BU: pilih satu konfigurasi default.'
                  : (presets ?? []).length === 0
                    ? 'Belum ada konfigurasi default: QR dibuat dengan nilai bawaan aplikasi, atau tambahkan preset untuk BU item.'
                    : 'BU item belum punya konfigurasi default: pilih salah satu atau tanpa preset.'}
                {(presets ?? []).length === 0
                  ? ''
                  : ' Isian di bawah terisi darinya dan dapat diubah.'}
              </p>
            </div>
          )}
        </Section>
      ) : null}
      {ready && !isDefaults && updatePresets && updatePresets.length > 0 ? (
        <Section title="Konfigurasi default">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              color="primary"
              onClick={() => setApplyOpen(true)}
            >
              Perbarui sesuai konfigurasi default
            </Button>
            <p className="text-xs text-muted-foreground">
              Pilih konfigurasi default dan bagian isi yang disalin ulang ke form ini.
            </p>
          </div>
          <ApplyPresetDialog
            open={applyOpen}
            onOpenChange={setApplyOpen}
            presets={updatePresets}
            onApply={applyPreset}
          />
        </Section>
      ) : null}

      {ready && manualBookFlow ? (
        <Section title="Nama Manual Book" data-tour="qr-name">
          <form.Field
            name="name"
            validators={{
              onSubmit: ({ value }) =>
                requireItems && (value ?? '').trim() === ''
                  ? 'Nama Manual Book wajib diisi'
                  : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="qr-manual-name" required={requireItems}>
                  Nama Manual Book
                </Label>
                <Input
                  id="qr-manual-name"
                  aria-required={requireItems ? true : undefined}
                  value={field.state.value}
                  maxLength={QR_LIMITS.manualBookName}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    nameTouched.current = true;
                    field.handleChange(event.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {newFlow
                    ? 'Dibuat dari tipe item dan boleh diedit. Menambah atau mengeluarkan item tidak mengubah nama yang sudah tersimpan.'
                    : 'Menambah atau mengeluarkan item tidak mengubah nama.'}
                </p>
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.name]} />
              </div>
            )}
          </form.Field>
        </Section>
      ) : null}
    </div>
  );
  const sumberTab = (
    <div className="space-y-4">
      {isDefaults ? null : (
        <Section title="Sumber link" data-tour="qr-source">
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              if (values.linkSource !== 'url') return null;
              const driveLink = parseDriveFileId(values.link) !== null;
              return (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">
                    Link saat ini (bukan salinan di aplikasi):{' '}
                    <span className="break-all">{values.link}</span>
                  </p>
                  {driveLink ? (
                    <Button
                      type="button"
                      variant="outline"
                      color="primary"
                      size="sm"
                      disabled={legacyCloning || pdfBusy}
                      onClick={() => void cloneLegacy(values.link)}
                    >
                      {legacyCloning ? (
                        <BusyLabel>Menyalin…</BusyLabel>
                      ) : (
                        'Salin link ini ke Drive aplikasi'
                      )}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Link ini bukan link Drive sehingga tidak dapat disalin. Unggah PDF atau salin
                      berkas dari Drive di bawah untuk menggantinya.
                    </p>
                  )}
                  {legacyCloning ? (
                    <p role="status" className="text-sm">
                      <BusyLabel>
                        Memeriksa berkas di Drive, lalu menyalinnya ke folder aplikasi…
                      </BusyLabel>
                    </p>
                  ) : null}
                  {legacyError ? (
                    <p role="alert" className="text-sm text-destructive-text">
                      {legacyError}
                    </p>
                  ) : null}
                </div>
              );
            }}
          </form.Subscribe>
          <form.Field name="documentId">
            {(field) => (
              <div className="space-y-1.5">
                <PdfSourceField
                  document={document}
                  onDocument={applyDocument}
                  onBusyChange={setPdfBusy}
                  onUpload={async (file, replaceId, ctx) =>
                    uploadPdf.mutateAsync({
                      name: limitDocumentName(file.name),
                      bytes: new Uint8Array(await file.arrayBuffer()),
                      ...(replaceId ? { replaceDocumentId: replaceId } : {}),
                      ...(ctx
                        ? {
                            onUploadProgress: (loaded: number, total: number) =>
                              ctx.onProgress(total > 0 ? Math.min(1, loaded / total) : null),
                          }
                        : {}),
                    })
                  }
                  onClone={(source, replaceId) =>
                    cloneQrPdf.mutateAsync({
                      source,
                      ...(replaceId ? { replaceDocumentId: replaceId } : {}),
                    })
                  }
                />
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.documentId]} />
                <FieldError errors={[fieldErrors?.link]} />
              </div>
            )}
          </form.Field>
        </Section>
      )}
    </div>
  );
  const labelTab = (
    <div className="space-y-4">
      {manualBookFlow ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const preset = newFlow
              ? activePreset
              : (updatePresets ?? presets)?.find((item) => item.id === edit?.presetId);
            if (!preset) return null;
            return (
              <PresetDeviationBanner
                presetName={preset.name}
                deviations={qrPresetDeviations(
                  {
                    title: values.title,
                    subtitle: values.subtitle,
                    footer: values.footer,
                    logoFileId: values.logoFileId,
                    layout: values.layout,
                    style: values.style,
                  },
                  {
                    title: preset.title,
                    subtitle: preset.subtitle,
                    footer: preset.footer,
                    defaultLogoId: preset.defaultLogoId,
                    layout: preset.layout,
                    style: preset.style,
                    namePlacement: preset.namePlacement,
                  },
                )}
              />
            );
          }}
        </form.Subscribe>
      ) : null}
      {isDefaults ? (
        <Section title="Business Unit dan nama Manual Book">
          <form.Field name="buId">
            {(field) => (
              <div className="space-y-1.5">
                <LinkField
                  id="qr-preset-bu"
                  required
                  label="Business Unit"
                  placeholder="Pilih Business Unit…"
                  value={field.state.value === '' ? null : field.state.value}
                  labelOf={(id) => businessUnits.find((unit) => unit.id === id)?.name}
                  options={businessUnitOptions(businessUnits, buTerm, takenBuIds)}
                  onSearchChange={setBuTerm}
                  searchDebounceMs={0}
                  onChange={(id) => field.handleChange(id ?? '')}
                />
                <p className="text-xs text-muted-foreground">
                  Satu BU hanya punya satu konfigurasi default; QR untuk item BU ini memakainya
                  otomatis.
                </p>
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.buId]} />
              </div>
            )}
          </form.Field>
          <form.Field name="namePlacement">
            {(field) => (
              <div className="space-y-1.5">
                <Select
                  id="qr-name-placement"
                  required
                  label="Penempatan nama Manual Book"
                  placeholder="Pilih bagian label…"
                  options={[
                    { value: 'title', label: 'Title' },
                    { value: 'subtitle', label: 'Subtitle' },
                    { value: 'footer', label: 'Footer' },
                  ]}
                  value={field.state.value}
                  onValueChange={(next) => field.handleChange(next as typeof field.state.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Bagian ini diisi nama Manual Book pada QR yang dibuat dari konfigurasi ini dan
                  terkunci; gaya teksnya tetap dapat diubah.
                </p>
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.namePlacement]} />
              </div>
            )}
          </form.Field>
        </Section>
      ) : null}
      <Section title="Isi label" data-tour="qr-label">
        {isDefaults ? (
          <form.Field name="name">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="qr-name" required>
                  Nama konfigurasi default
                </Label>
                <Input
                  id="qr-name"
                  aria-required="true"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.name]} />
              </div>
            )}
          </form.Field>
        ) : null}
        {(['title', 'subtitle', 'footer'] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="space-y-1.5">
                <Label
                  htmlFor={`qr-${name}`}
                  required={name === 'title' && !isDefaults && lockedPart !== 'title'}
                >
                  {name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer'}
                </Label>
                <form.Subscribe selector={(state) => state.values.namePlacement}>
                  {(placement) => {
                    const locked = isDefaults ? placement === name : lockedPart === name;
                    return (
                      <>
                        <Input
                          id={`qr-${name}`}
                          aria-required={
                            name === 'title' && !isDefaults && !locked ? true : undefined
                          }
                          value={isDefaults && locked ? '' : field.state.value}
                          placeholder={isDefaults && locked ? 'Diisi nama Manual Book' : undefined}
                          disabled={locked}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                        {locked ? (
                          <p className="text-xs text-muted-foreground">
                            {isDefaults
                              ? 'Bagian ini diisi nama Manual Book saat QR dibuat.'
                              : 'Terkunci: bagian ini mengikuti Nama Manual Book (gayanya tetap dapat diubah).'}
                          </p>
                        ) : null}
                      </>
                    );
                  }}
                </form.Subscribe>
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.[name]]} />
                <form.Subscribe selector={(state) => state.values.layout[TEXT_SIZE_KEY[name]]}>
                  {(size) => {
                    const sizeKey = TEXT_SIZE_KEY[name];
                    const part =
                      name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer';
                    const message = layoutRangeMessage(sizeKey, size);
                    return (
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`qr-size-${name}`}
                          className="text-xs text-muted-foreground"
                        >
                          {`Ukuran ${part} (pt)`}
                        </Label>
                        <Input
                          id={`qr-size-${name}`}
                          type="number"
                          className="h-8 w-24"
                          step={QR_LAYOUT_RANGES[sizeKey].step}
                          min={QR_LAYOUT_RANGES[sizeKey].min}
                          max={QR_LAYOUT_RANGES[sizeKey].max}
                          aria-invalid={message ? true : undefined}
                          value={Number.isNaN(size) ? '' : size}
                          onChange={(event) =>
                            form.setFieldValue('layout', {
                              ...form.state.values.layout,
                              [sizeKey]:
                                event.target.value === '' ? Number.NaN : Number(event.target.value),
                            })
                          }
                        />
                        {message ? (
                          <span className="text-sm text-destructive-text">{message}</span>
                        ) : null}
                      </div>
                    );
                  }}
                </form.Subscribe>
                <form.Subscribe selector={(state) => state.values.style[name]}>
                  {(textStyle) => (
                    <TextStyleToolbar
                      part={
                        name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer'
                      }
                      value={textStyle}
                      onChange={(next) =>
                        form.setFieldValue('style', {
                          ...form.state.values.style,
                          [name]: next,
                        })
                      }
                    />
                  )}
                </form.Subscribe>
              </div>
            )}
          </form.Field>
        ))}
      </Section>
    </div>
  );
  const logoTab = (
    <div className="space-y-4">
      <Section title={isDefaults ? 'Logo awal' : 'Logo di tengah QR'} data-tour="qr-logo">
        <form.Field name="logoFileId">
          {(field) => (
            <div className="space-y-1.5">
              <LogoPicker
                value={field.state.value}
                onChange={field.handleChange}
                library={logoLibrary}
              />
              <FieldError
                errors={[
                  ...field.state.meta.errors,
                  fieldErrors?.logoFileId,
                  fieldErrors?.defaultLogoId,
                ]}
              />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Bingkai QR" data-tour="qr-frame">
        <form.Subscribe selector={(state) => state.values.style.frame}>
          {(frame) => (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Jenis bingkai" className="flex flex-wrap gap-4">
                {(
                  [
                    ['none', 'Tanpa bingkai'],
                    ['corners', 'Siku di sudut'],
                    ['box', 'Kotak penuh'],
                  ] as const
                ).map(([kind, label]) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="qr-frame-kind"
                      checked={frame.kind === kind}
                      onChange={() =>
                        form.setFieldValue('style', {
                          ...form.state.values.style,
                          frame: { ...form.state.values.style.frame, kind },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              {frame.kind !== 'none' ? (
                <div role="radiogroup" aria-label="Gaya garis" className="flex flex-wrap gap-4">
                  {(
                    [
                      ['solid', 'Solid'],
                      ['dashed', 'Putus-putus'],
                      ['dotted', 'Titik-titik'],
                    ] as const
                  ).map(([line, label]) => (
                    <label key={line} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="qr-frame-line"
                        checked={frame.line === line}
                        onChange={() =>
                          form.setFieldValue('style', {
                            ...form.state.values.style,
                            frame: { ...form.state.values.style.frame, line },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              ) : null}
              {frame.kind !== 'none' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {QR_FRAME_KEYS.filter((key) => key !== 'arm' || frame.kind === 'corners').map(
                    (key) => {
                      const range = QR_FRAME_RANGES[key];
                      const id = `qr-frame-${key}`;
                      const message = frameRangeMessage(key, frame[key]);
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label htmlFor={id}>{`${range.label} (${range.unit})`}</Label>
                          <Input
                            id={id}
                            type="number"
                            step={range.step}
                            min={range.min}
                            max={range.max}
                            aria-invalid={message ? true : undefined}
                            value={Number.isNaN(frame[key]) ? '' : frame[key]}
                            onChange={(event) =>
                              form.setFieldValue('style', {
                                ...form.state.values.style,
                                frame: {
                                  ...form.state.values.style.frame,
                                  [key]:
                                    event.target.value === ''
                                      ? Number.NaN
                                      : Number(event.target.value),
                                },
                              })
                            }
                          />
                          {message ? (
                            <p className="text-sm text-destructive-text">{message}</p>
                          ) : null}
                        </div>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </Section>
    </div>
  );
  const ukuranTab = (
    <div className="space-y-4">
      <Section title="Ukuran" data-tour="qr-size">
        <form.Field name="layout">
          {(field) => (
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {QR_LAYOUT_KEYS.filter((key) => !TEXT_SIZE_KEYS.includes(key)).map((key) => {
                  const range = QR_LAYOUT_RANGES[key];
                  const id = `qr-layout-${key}`;
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={id}>{`${range.label} (${range.unit})`}</Label>
                      <Input
                        id={id}
                        type="number"
                        step={range.step}
                        min={range.min}
                        max={range.max}
                        value={Number.isNaN(field.state.value[key]) ? '' : field.state.value[key]}
                        aria-invalid={
                          layoutRangeMessage(key, field.state.value[key]) ? true : undefined
                        }
                        onChange={(event) =>
                          field.handleChange({
                            ...field.state.value,
                            [key]:
                              event.target.value === '' ? Number.NaN : Number(event.target.value),
                          })
                        }
                      />
                      {layoutRangeMessage(key, field.state.value[key]) ? (
                        <p className="text-sm text-destructive-text">
                          {layoutRangeMessage(key, field.state.value[key])}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.layout]} />
            </div>
          )}
        </form.Field>
      </Section>
    </div>
  );

  // Satu tab "Detail": item, konfigurasi default, nama, lalu sumber link (sumber hanya setelah form siap, seperti tab lama).
  const detailTab = (
    <div className="space-y-4">
      {itemTab}
      {ready ? sumberTab : null}
    </div>
  );
  const tabContent: Record<QrFormTab, React.ReactNode> = {
    detail: detailTab,
    label: labelTab,
    logo: logoTab,
    ukuran: ukuranTab,
  };
  // Sebelum siap (QR baru belum memilih item) hanya tab Detail; sisanya muncul setelah itu. Mode default tak punya Detail.
  const visibleTabs = QR_FORM_TABS.filter((id) =>
    !ready ? id === 'detail' : id === 'detail' ? !isDefaults : true,
  );

  // Tab aktif: terkendali bila pembungkus memberi `activeTab`, selain itu lokal.
  const [localTab, setLocalTab] = useState<QrFormTab>(
    isDefaults ? 'label' : (visibleTabs[0] ?? 'detail'),
  );
  const tab = activeTab ?? localTab;
  const selectTab = (next: QrFormTab) => {
    setLocalTab(next);
    onActiveTabChange?.(next);
  };
  // Titik galat per tab: galat validasi field (setelah submit) atau galat server.
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const attempts = useStore(form.store, (state) => state.submissionAttempts);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const fieldHasError = (key: string) =>
    ((fieldMeta as Record<string, { errors?: unknown[] } | undefined>)[key]?.errors?.length ?? 0) >
      0 || Boolean(fieldErrors?.[key]);
  const errorKeys = [...Object.keys(fieldMeta), ...Object.keys(fieldErrors ?? {})].filter(
    (key, index, all) => all.indexOf(key) === index && fieldHasError(key),
  );
  const tabHasError = (id: QrFormTab) =>
    errorKeys.some((key) => tabOfField(key, isDefaults) === id);
  const firstErrorTab = visibleTabs.find((id) => tabHasError(id));
  // Simpan gagal validasi: buka tab bergalat pertama (sekali per percobaan simpan).
  const handledAttempt = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dijalankan saat percobaan simpan selesai
  useEffect(() => {
    if (attempts === 0 || submitting || handledAttempt.current === attempts) return;
    handledAttempt.current = attempts;
    if (firstErrorTab) selectTab(firstErrorTab);
  }, [attempts, submitting]);
  // Galat dari server: buka tab pertama yang memuatnya.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat galat server yang baru datang
  useEffect(() => {
    const first = visibleTabs.find((id) =>
      Object.keys(fieldErrors ?? {}).some(
        (key) => fieldErrors?.[key] && tabOfField(key, isDefaults) === id,
      ),
    );
    if (first) selectTab(first);
  }, [fieldErrors]);

  // Keadaan untuk tombol di luar form (bar halaman / footer dialog).
  const blocked = !ready || logoBusy || pdfBusy || legacyCloning;
  const overflow = labelStatus?.overflow === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: dilaporkan hanya saat salah satu nilainya berubah
  useEffect(() => {
    onUiState?.({ submitting, blocked, overflow });
  }, [submitting, blocked, overflow]);

  const tabs: FormTab[] = visibleTabs.map((id) => ({
    id,
    label: TAB_LABEL[id],
    hasError: tabHasError(id),
    content: tabContent[id],
  }));

  return (
    <>
      <form
        id={formId}
        noValidate
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          // Dialog turunan (Tambah item/preset) dirender lewat portal React: submitnya tak boleh naik ke form ini.
          event.stopPropagation();
          // Tujuan setelah simpan dibaca dari tombol pengirim; tombol Simpan biasa tak membawa penandanya.
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          exportAfterRef.current = submitter?.getAttribute('data-export') === 'true';
          void form.handleSubmit();
        }}
      >
        <div className="lg:col-span-2">
          <LabelStatusAlerts status={labelStatus} />
        </div>
        <div className="min-w-0 space-y-4">
          <FormTabs tabs={tabs} value={tab} onValueChange={(id) => selectTab(id as QrFormTab)} />
          {submitError ? (
            <p role="alert" className="text-sm text-destructive-text">
              {submitError}
            </p>
          ) : null}
        </div>
        {ready ? (
          <aside data-tour="qr-preview" className="space-y-3 lg:sticky lg:top-36 lg:self-start">
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <PreviewPane
                  values={
                    isDefaults && values.namePlacement !== ''
                      ? { ...values, [values.namePlacement]: 'Nama Manual Book' }
                      : values
                  }
                  document={document}
                  sheetOpen={sheetOpen}
                  onSheetOpenChange={setSheetOpen}
                  onStatus={setLabelStatus}
                />
              )}
            </form.Subscribe>
          </aside>
        ) : null}
      </form>
      <ExportChangeWarning
        open={pendingSave !== null}
        stickerVersion={edit?.stickerVersion ?? 0}
        onCancel={() => setPendingSave(null)}
        onConfirm={() => {
          const pending = pendingSave;
          setPendingSave(null);
          if (pending) void onSubmit(pending.values, pending.options);
        }}
      />
      {presetDialogOpen ? (
        // Dirender di luar `<form>` (seperti dialog item): submit dialog lewat portal React tak boleh naik ke form QR.
        <QrPresetFormDialog
          open
          onOpenChange={setPresetDialogOpen}
          businessUnits={presetlessBus}
          logoLibrary={logoLibrary}
          onCreated={(preset) => setChosenPreset(preset.id)}
        />
      ) : null}
      {canCreateItem ? (
        // Dirender di luar `<form>`: submit dialog lewat portal React tidak boleh naik ke form QR.
        <ItemFormDialog
          open={itemDialogOpen}
          onOpenChange={setItemDialogOpen}
          onCreated={(item) =>
            changeItems([
              ...selected,
              {
                id: item.id,
                brand: item.brand,
                model: item.model,
                businessUnitIds: item.businessUnits.map((bu) => bu.id),
              },
            ])
          }
        />
      ) : null}
    </>
  );
}

function PreviewPane({
  values,
  document,
  sheetOpen,
  onSheetOpenChange,
  onStatus,
}: {
  values: QrFormInput;
  document: QrDocumentDto | null;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  onStatus: (status: LabelStatus) => void;
}) {
  const { url: logoUrl } = useFileUrl(values.logoFileId);
  const link = values.linkSource === 'url' ? values.link : (document?.link ?? '');
  const logo = values.logoFileId !== '' ? logoUrl : null;
  return (
    <>
      <LabelPreview
        title={values.title}
        subtitle={values.subtitle}
        footer={values.footer}
        link={link}
        layout={values.layout}
        style={values.style}
        logoUrl={logo}
        onStatus={onStatus}
      />
      <Button
        type="button"
        variant="outline"
        color="primary"
        onClick={() => onSheetOpenChange(true)}
      >
        Pratinjau lembar
      </Button>
      <SheetPreviewDialog
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        design={{
          title: values.title,
          subtitle: values.subtitle,
          footer: values.footer,
          link,
          layout: values.layout,
          style: values.style,
        }}
        logoUrl={logo}
      />
    </>
  );
}
