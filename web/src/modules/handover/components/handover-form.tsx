import type { HandoverOptionsDto } from '@shared/contract';
import { useForm, useStore } from '@tanstack/react-form';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { FormHeader } from '@/components/form-header';
import { Label } from '@/components/ui/label';
import { LocationField } from '@/modules/location/location-field';
import type { HandoverFieldErrors, HandoverFormInput, HandoverFormOutput } from '../schemas';
import { handoverFormSchema } from '../schemas';
import { CustomerCombobox } from './customer-combobox';
import { NoteEditor } from './note-editor';

export interface HandoverFormProps {
  /** Judul halaman, tampil di bar sticky bersama tombol aksi. */
  title: string;
  mode: 'create' | 'edit';
  defaultValues: HandoverFormInput;
  options: HandoverOptionsDto;
  /** Mode ubah: nama lokasi ditampilkan sebagai teks (lokasi task tidak dapat dipindah). */
  locationName?: string;
  submitError?: string | null;
  /** Galat per field dari server (mis. customer nonaktif). */
  fieldErrors?: HandoverFieldErrors;
  onSubmit: (values: HandoverFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function HandoverForm({
  mode,
  defaultValues,
  options,
  locationName,
  title,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: HandoverFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: handoverFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(handoverFormSchema.parse(value));
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
            title={title}
            onCancel={onCancel}
            submitting={isSubmitting}
            busyText="Menyimpan task…"
          />
        )}
      </form.Subscribe>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Informasi task</h2>
        <form.Field name="locationId">
          {(field) => (
            <div className="space-y-1.5">
              {mode === 'edit' ? (
                <>
                  <Label>Lokasi</Label>
                  <p className="text-sm">{locationName ?? field.state.value}</p>
                </>
              ) : (
                <LocationField
                  id="handover-location"
                  module="handover"
                  level="edit"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.locationId]} />
            </div>
          )}
        </form.Field>
        <form.Field name="customerName">
          {(field) => (
            <div className="space-y-1.5">
              <CustomerCombobox
                id="handover-customer"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                customers={options.customers}
                inactiveNames={options.inactiveCustomerNames}
                currentName={mode === 'edit' ? defaultValues.customerName : undefined}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.customerName]} />
            </div>
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <div className="space-y-1.5">
              <Label id="handover-note-label">Catatan</Label>
              <NoteEditor
                id="handover-note"
                labelledBy="handover-note-label"
                value={field.state.value}
                onChange={field.handleChange}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.note]} />
            </div>
          )}
        </form.Field>
      </section>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
