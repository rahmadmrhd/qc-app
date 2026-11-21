import { useForm, useStore } from '@tanstack/react-form';
import { useEffect } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type CustomerFormInput, type CustomerFormOutput, customerFormSchema } from '../schemas';

export interface CustomerFormProps {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  defaultValues: CustomerFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. nama sudah dipakai customer lain). */
  fieldErrors?: { name?: string };
  onSubmit: (values: CustomerFormOutput) => Promise<unknown>;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
}

/** Isi form ubah customer (hanya field Nama); customer tidak dibuat dari sini. */
export function CustomerForm({
  formId,
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onBusyChange,
}: CustomerFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: customerFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(customerFormSchema.parse(value));
    },
  });
  useUnsavedChanges(useStore(form.store, (state) => state.isDirty && !state.isSubmitSuccessful));
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  useEffect(() => onBusyChange?.(submitting), [submitting, onBusyChange]);

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="customer-name" required>
              Nama
            </Label>
            <Input
              id="customer-name"
              aria-required="true"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Berlaku ke semua task serah terima customer ini.
            </p>
            <FieldError errors={[...field.state.meta.errors, fieldErrors?.name]} />
          </div>
        )}
      </form.Field>
      {submitError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {submitError}
        </p>
      ) : null}
      {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di footer dialog (di luar form). */}
      <button type="submit" hidden tabIndex={-1} aria-hidden />
    </form>
  );
}
