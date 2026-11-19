import { useForm, useStore } from '@tanstack/react-form';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocationFormInput, LocationFormOutput } from '../schemas';
import { locationFormSchema } from '../schemas';

export interface LocationFormProps {
  mode: 'create' | 'edit';
  defaultValues: LocationFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. kode sudah dipakai). */
  fieldErrors?: { code?: string; name?: string };
  onSubmit: (values: LocationFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function LocationForm({
  mode,
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: LocationFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: locationFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(locationFormSchema.parse(value));
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
      <form.Field name="code">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="location-code">Kode</Label>
            <Input
              id="location-code"
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
            <Label htmlFor="location-name">Nama</Label>
            <Input
              id="location-name"
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Menyimpan…' : 'Simpan'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
