import type { PostelDto, SavePostelInput } from '@shared/contract';
import { useForm, useStore } from '@tanstack/react-form';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormSection } from '@/components/page/form-section';
import { type FormTab, FormTabs } from '@/components/page/form-tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText, errorTexts } from '@/modules/item/lib/row-error';
import {
  type PostelFieldErrors,
  postelFormSchema,
  toPostelFormDefaults,
  toSavePostelInput,
} from '../lib/schemas';
import { AttachmentsField } from './attachments-field';
import { NumberTableField } from './number-table-field';
import { PostelItemPicker } from './postel-item-picker';

export const POSTEL_FORM_TABS = ['item', 'nomor', 'catatan'] as const;
export type PostelFormTab = (typeof POSTEL_FORM_TABS)[number];

const TAB_LABEL: Record<PostelFormTab, string> = {
  item: 'Item',
  nomor: 'Nomor sertifikat',
  catatan: 'Catatan dan lampiran',
};

/** Tab pemilik sebuah field (nama field form atau kunci galat server). */
function tabOfField(key: string): PostelFormTab | undefined {
  if (key === 'items' || key === 'itemIds') return 'item';
  if (key === 'numbers' || key === 'number') return 'nomor';
  if (key === 'note' || key === 'attachments' || key === 'attachmentIds') return 'catatan';
  return undefined;
}

/** Keadaan form untuk tombol di luar form (bar halaman): proses simpan, dan unggahan lampiran yang menahan Simpan. */
export interface PostelFormUiState {
  submitting: boolean;
  blocked: boolean;
}

/** Opsi hook tab Postel (dipakai form Postel dan form Stiker yang menyisipkan tab Postel sebagai tab sejajar). */
export interface PostelFormTabsOptions {
  /** Catatan yang diubah; kosong = mode tambah. */
  postel?: PostelDto | undefined;
  /** Ambang "segera habis" dan tanggal WIB server (dasar lencana kondisi pada tabel nomor). */
  soonDays: number;
  today: string;
  /** Mengirim payload; mengembalikan teks galat (tampil sebagai alert) atau `null` bila berhasil/ditangani. */
  onSubmit: (input: SavePostelInput) => Promise<string | null>;
  /** Galat server per field (dari `ApiError.fields`); hilang begitu field-nya dikoreksi. */
  fieldErrors?: PostelFieldErrors | undefined;
  /** Boleh menambah item dari pemilih item (`itemLinkAccess(...).canCreate`). */
  canCreateItem?: boolean | undefined;
  /** Tab aktif terkendali (id tab sejajar milik pemanggil); tanpa ini tab dikelola sendiri. */
  activeTab?: string | undefined;
  onActiveTabChange?: ((tab: string) => void) | undefined;
}

export interface PostelFormProps extends PostelFormTabsOptions {
  /** Id elemen `<form>`; tombol Simpan di bar halaman men-submit lewat `form={formId}`. */
  formId: string;
  onUiState?: ((state: PostelFormUiState) => void) | undefined;
}

/**
 * Logika form Postel dalam tiga tab: Item, Nomor sertifikat, serta Catatan dan lampiran. Saat simpan gagal, tab
 * bergalat pertama dibuka dan diberi titik merah. Tanpa `<form>` sendiri: pemanggil merender `tabs` (sendiri lewat
 * `PostelForm`, atau sebagai tab sejajar di form lain) dan memanggil `submit`.
 */
export function usePostelFormTabs({
  postel,
  soonDays,
  today,
  onSubmit,
  fieldErrors,
  canCreateItem,
  activeTab,
  onActiveTabChange,
}: PostelFormTabsOptions) {
  const hiddenCount = postel?.hiddenItemCount ?? 0;
  const schema = useMemo(() => postelFormSchema(hiddenCount), [hiddenCount]);
  const ownedIds = useMemo(() => new Set(postel?.items.map((item) => item.id)), [postel]);
  // Nilai awal dihitung sekali (baris baru memakai kunci acak yang tidak boleh berganti tiap render).
  const [defaults] = useState(() => toPostelFormDefaults(postel));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ownTab, setOwnTab] = useState<string>('item');
  const tab = activeTab ?? ownTab;
  const setTab = (next: string) => {
    setOwnTab(next);
    onActiveTabChange?.(next);
  };
  // Galat server pada sebuah field hilang begitu user mengoreksi field itu (dan kembali saat ada galat baru).
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset setiap kali galat server yang baru datang
  useEffect(() => setCleared(new Set()), [fieldErrors]);
  const serverError = (key: keyof PostelFieldErrors) =>
    cleared.has(key) ? undefined : fieldErrors?.[key];
  const clear = (...keys: (keyof PostelFieldErrors)[]) =>
    setCleared((previous) => new Set([...previous, ...keys]));

  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      setSubmitError(await onSubmit(toSavePostelInput(value, postel)));
    },
  });
  useUnsavedChanges(useStore(form.store, (state) => state.isDirty && !state.isSubmitSuccessful));

  // Titik galat per tab: galat validasi field (setelah submit) atau galat server.
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const attempts = useStore(form.store, (state) => state.submissionAttempts);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const fieldHasError = (key: string) =>
    ((fieldMeta as Record<string, { errors?: unknown[] } | undefined>)[key]?.errors?.length ?? 0) >
      0 || Boolean(serverError(key as keyof PostelFieldErrors));
  const errorKeys = [...Object.keys(fieldMeta), ...Object.keys(fieldErrors ?? {})].filter(
    (key, index, all) => all.indexOf(key) === index && fieldHasError(key),
  );
  const tabHasError = (id: PostelFormTab) => errorKeys.some((key) => tabOfField(key) === id);
  const firstErrorTab = POSTEL_FORM_TABS.find((id) => tabHasError(id));
  // Simpan gagal validasi: buka tab bergalat pertama (sekali per percobaan simpan).
  const handledAttempt = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dijalankan saat percobaan simpan selesai
  useEffect(() => {
    if (attempts === 0 || submitting || handledAttempt.current === attempts) return;
    handledAttempt.current = attempts;
    if (firstErrorTab) setTab(firstErrorTab);
  }, [attempts, submitting]);
  // Galat dari server: buka tab pertama yang memuatnya.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat galat server yang baru datang
  useEffect(() => {
    const first = POSTEL_FORM_TABS.find((id) =>
      Object.keys(fieldErrors ?? {}).some(
        (key) => fieldErrors?.[key as keyof PostelFieldErrors] && tabOfField(key) === id,
      ),
    );
    if (first) setTab(first);
  }, [fieldErrors]);

  const content: Record<PostelFormTab, ReactNode> = {
    item: (
      <FormSection title="Item" columns={1}>
        <form.Field name="items">
          {(field) => (
            <PostelItemPicker
              selected={field.state.value}
              ownedIds={ownedIds}
              hiddenCount={hiddenCount}
              canCreateItem={canCreateItem}
              error={errorText([...field.state.meta.errors, serverError('itemIds')])}
              onChange={(items) => {
                field.handleChange(items);
                clear('itemIds');
              }}
            />
          )}
        </form.Field>
      </FormSection>
    ),
    nomor: (
      <FormSection title="Nomor sertifikat" columns={1}>
        <form.Field name="numbers">
          {(field) => (
            <NumberTableField
              value={field.state.value}
              soonDays={soonDays}
              today={today}
              errors={errorTexts([
                ...field.state.meta.errors,
                serverError('numbers'),
                serverError('number'),
              ])}
              onChange={(rows) => {
                field.handleChange(rows);
                clear('numbers', 'number');
              }}
            />
          )}
        </form.Field>
      </FormSection>
    ),
    catatan: (
      <div className="space-y-6">
        <FormSection title="Catatan" columns={1}>
          <form.Field name="note">
            {(field) => {
              const error = errorText([...field.state.meta.errors, serverError('note')]);
              return (
                <div className="space-y-1.5">
                  <Label htmlFor="postel-note" className="sr-only">
                    Catatan
                  </Label>
                  <Textarea
                    id="postel-note"
                    aria-invalid={error ? true : undefined}
                    placeholder="Catatan (opsional)"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      clear('note');
                    }}
                  />
                  {error ? <p className="text-sm text-destructive-text">{error}</p> : null}
                </div>
              );
            }}
          </form.Field>
        </FormSection>
        <FormSection title="Lampiran" columns={1}>
          <form.Field name="attachments">
            {(field) => (
              <AttachmentsField
                value={field.state.value}
                error={errorText([...field.state.meta.errors, serverError('attachmentIds')])}
                onBusyChange={setUploading}
                onChange={(rows) => {
                  field.handleChange(rows);
                  clear('attachmentIds');
                }}
              />
            )}
          </form.Field>
        </FormSection>
      </div>
    ),
  };

  const tabs: FormTab[] = POSTEL_FORM_TABS.map((id) => ({
    id,
    label: TAB_LABEL[id],
    hasError: tabHasError(id),
    content: content[id],
  }));

  return {
    tabs,
    tab,
    setTab,
    submitError,
    submitting,
    uploading,
    /** Menjalankan validasi dan `onSubmit` (galat field menandai tab dan membuka tab bergalat pertama). */
    submit: () => form.handleSubmit(),
  };
}

/**
 * Form tambah/ubah catatan Postel dalam tiga tab (kit `FormTabs`): Item, Nomor sertifikat, serta Catatan dan lampiran.
 * Komponen ini hanya merender `<form id={formId}>` berisi field; tombol Simpan ada di `FormPage` (di luar form).
 */
export function PostelForm({ formId, onUiState, ...options }: PostelFormProps) {
  const { tabs, tab, setTab, submitError, submitting, uploading, submit } =
    usePostelFormTabs(options);
  // Keadaan untuk tombol di luar form (bar halaman): unggahan lampiran menahan Simpan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dilaporkan hanya saat salah satu nilainya berubah
  useEffect(() => {
    onUiState?.({ submitting, blocked: uploading });
  }, [submitting, uploading]);
  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Dialog turunan (Tambah item) dirender lewat portal React: submitnya tak boleh naik ke form ini.
        event.stopPropagation();
        void submit();
      }}
    >
      <FormTabs tabs={tabs} value={tab} onValueChange={setTab} />
      {submitError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
