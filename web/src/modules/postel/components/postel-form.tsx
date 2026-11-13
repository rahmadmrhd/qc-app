import type { PostelDto, SavePostelInput } from '@shared/contract';
import { useForm, useStore } from '@tanstack/react-form';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormHeader } from '@/components/form-header';
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

export interface PostelFormProps {
  /** Catatan yang diubah; kosong = mode tambah. */
  postel?: PostelDto | undefined;
  /** Ambang "segera habis" dan tanggal WIB server (dasar lencana kondisi pada tabel nomor). */
  soonDays: number;
  today: string;
  /** Mengirim payload; mengembalikan teks galat (tampil sebagai alert) atau `null` bila berhasil/ditangani. */
  onSubmit: (input: SavePostelInput) => Promise<string | null>;
  onCancel: () => void;
  /** Galat server per field (dari `ApiError.fields`); hilang begitu field-nya dikoreksi. */
  fieldErrors?: PostelFieldErrors | undefined;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Form tambah/ubah catatan Postel: item, tabel nomor sertifikat, catatan, dan lampiran. */
export function PostelForm({
  postel,
  soonDays,
  today,
  onSubmit,
  onCancel,
  fieldErrors,
}: PostelFormProps) {
  const hiddenCount = postel?.hiddenItemCount ?? 0;
  const schema = useMemo(() => postelFormSchema(hiddenCount), [hiddenCount]);
  const ownedIds = useMemo(() => new Set(postel?.items.map((item) => item.id)), [postel]);
  // Nilai awal dihitung sekali (baris baru memakai kunci acak yang tidak boleh berganti tiap render).
  const [defaults] = useState(() => toPostelFormDefaults(postel));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  return (
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
            title={postel ? `Ubah Postel: ${postel.name}` : 'Tambah Postel'}
            onCancel={onCancel}
            submitting={isSubmitting}
            submitDisabled={uploading}
            busyText="Menyimpan Postel…"
          />
        )}
      </form.Subscribe>

      <Section title="Item">
        <form.Field name="items">
          {(field) => (
            <PostelItemPicker
              selected={field.state.value}
              ownedIds={ownedIds}
              hiddenCount={hiddenCount}
              error={errorText([...field.state.meta.errors, serverError('itemIds')])}
              onChange={(items) => {
                field.handleChange(items);
                clear('itemIds');
              }}
            />
          )}
        </form.Field>
      </Section>

      <Section title="Nomor sertifikat">
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
      </Section>

      <Section title="Catatan">
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
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </div>
            );
          }}
        </form.Field>
      </Section>

      <Section title="Lampiran">
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
      </Section>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
