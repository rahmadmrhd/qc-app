import type { HandoverOptionsDto } from '@shared/rpc';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LocationField } from '@/modules/location/location-field';
import type { HandoverFieldErrors, HandoverFormInput, HandoverFormOutput } from '../schemas';
import { handoverFormSchema } from '../schemas';
import { CustomerCombobox } from './customer-combobox';
import { ItemLinesField } from './item-lines-field';

export interface HandoverFormProps {
  mode: 'create' | 'edit';
  defaultValues: HandoverFormInput;
  options: HandoverOptionsDto;
  /** Mode ubah: nama lokasi ditampilkan sebagai teks (lokasi task tidak dapat dipindah). */
  locationName?: string;
  /** Tautan "Tambah item baru" (hanya bila user punya `item: edit`). */
  createItemLink?: ReactNode;
  submitError?: string | null;
  /** Galat per field dari server (mis. customer nonaktif, qty di bawah qty selesai). */
  fieldErrors?: HandoverFieldErrors;
  onSubmit: (values: HandoverFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function HandoverForm({
  mode,
  defaultValues,
  options,
  locationName,
  createItemLink,
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

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
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
                currentName={mode === 'edit' ? defaultValues.customerName : undefined}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.customerName]} />
            </div>
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="handover-note">Catatan</Label>
              <Textarea
                id="handover-note"
                rows={3}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.note]} />
            </div>
          )}
        </form.Field>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h2 className="text-base font-semibold">Tipe dan qty</h2>
          <p className="text-sm text-muted-foreground">Setiap tipe hanya sekali per task.</p>
        </div>
        <form.Field name="lines">
          {(field) => (
            <div className="space-y-1.5">
              <ItemLinesField
                options={options.items}
                value={field.state.value}
                onChange={field.handleChange}
                createItemLink={createItemLink}
              />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.lines]} />
            </div>
          )}
        </form.Field>
      </section>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
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
