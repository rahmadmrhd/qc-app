import { useForm, useStore } from '@tanstack/react-form';
import { useEffect } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocationFormInput, LocationFormOutput } from '../schemas';
import { locationFormSchema } from '../schemas';

export interface LocationFormProps {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  mode: 'create' | 'edit';
  defaultValues: LocationFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. kode sudah dipakai). */
  fieldErrors?: { code?: string; name?: string };
  onSubmit: (values: LocationFormOutput) => Promise<unknown>;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
}

export function LocationForm({
  formId,
  mode,
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onBusyChange,
}: LocationFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: locationFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(locationFormSchema.parse(value));
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
      <form.Field name="code">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="location-code" required>
              Kode
            </Label>
            <Input
              id="location-code"
              aria-required="true"
              value={field.state.value}
              disabled={mode === 'edit'}
              placeholder="mis. JKT-01"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Huruf, angka, dan tanda hubung, maksimal 10 karakter. Tidak dapat diubah setelah
              dibuat.
            </p>
            <FieldError errors={[...field.state.meta.errors, fieldErrors?.code]} />
          </div>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="location-name" required>
              Nama
            </Label>
            <Input
              id="location-name"
              aria-required="true"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
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
