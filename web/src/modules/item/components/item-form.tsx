import { normalizeKey } from '@shared/items';
import type { BrandDto } from '@shared/rpc';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownEditor } from '@/modules/markdown/markdown-editor';
import type { ItemFieldErrors, ItemFormInput, ItemFormOutput } from '../schemas';
import { itemFormSchema } from '../schemas';
import { AccessoryListField } from './accessory-list-field';
import { ImageGalleryField } from './image-gallery-field';
import { StickerListField } from './sticker-list-field';

export interface ItemFormProps {
  mode: 'create' | 'edit';
  /** Merk yang sudah ada, untuk saran saat mengetik; merk yang belum ada dibuat saat item disimpan. */
  brands?: readonly BrandDto[];
  defaultValues: ItemFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. merk+tipe sudah dipakai). */
  fieldErrors?: ItemFieldErrors;
  onSubmit: (values: ItemFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

/** Petunjuk di bawah isian merk: dipakai ulang, dinonaktifkan, atau akan dibuat baru. */
function BrandHint({ value, brands }: { value: string; brands: readonly BrandDto[] }) {
  const key = normalizeKey(value);
  if (key === '') return null;
  const match = brands.find((brand) => normalizeKey(brand.name) === key);
  if (!match) {
    return (
      <p className="text-xs text-muted-foreground">
        Merk baru "{value.trim()}" akan dibuat saat item disimpan.
      </p>
    );
  }
  if (match.status === 'inactive') {
    return (
      <p className="text-xs text-destructive">
        Merk "{match.name}" dinonaktifkan; aktifkan dulu di halaman Merk.
      </p>
    );
  }
  if (match.name !== value.trim()) {
    return (
      <p className="text-xs text-muted-foreground">Memakai merk yang sudah ada: "{match.name}".</p>
    );
  }
  return null;
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
  mode,
  brands = [],
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: itemFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(itemFormSchema.parse(value));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      data-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Section title="Informasi dasar">
        <form.Field name="brand">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="item-brand">Merk</Label>
              <Input
                id="item-brand"
                list="item-brand-options"
                autoComplete="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <datalist id="item-brand-options">
                {brands
                  .filter((brand) => brand.status === 'active')
                  .map((brand) => (
                    <option key={brand.id} value={brand.name} />
                  ))}
              </datalist>
              <BrandHint value={field.state.value} brands={brands} />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.brand]} />
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
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.model]} />
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
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Satu per baris. Dipakai untuk pencarian dan saran saat mengetik tipe.
              </p>
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.aliases]} />
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
              <ImageGalleryField value={field.state.value} onChange={field.handleChange} />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.attachments]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Stiker yang perlu ditempel" hint="QC memakai daftar ini sebagai acuan.">
        <form.Field name="stickers">
          {(field) => (
            <div className="space-y-1.5">
              <StickerListField value={field.state.value} onChange={field.handleChange} />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.stickers]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Kelengkapan aksesoris" hint="Jumlah per unit.">
        <form.Field name="accessories">
          {(field) => (
            <div className="space-y-1.5">
              <AccessoryListField value={field.state.value} onChange={field.handleChange} />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.accessories]} />
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
              <MarkdownEditor
                id="item-detail"
                labelledBy="item-detail-label"
                value={field.state.value}
                onChange={field.handleChange}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.detail]} />
            </div>
          )}
        </form.Field>
      </Section>

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
