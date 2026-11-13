import { ALL_LOCATIONS_KEY } from '@shared/assignments';
import { ALL_BU_KEY } from '@shared/business-units';
import type { BusinessUnitOptionDto, LocationDto, RoleDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useForm, useStore } from '@tanstack/react-form';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { LinkField, LinkMultiField } from '@/components/link-field';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserFormInput, UserFormOutput } from '../schemas';
import { userFormSchema } from '../schemas';

export interface UserFormProps {
  mode: 'create' | 'edit';
  defaultValues: UserFormInput;
  roles: readonly RoleDto[];
  locations: readonly LocationDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Tautan ke halaman lihat BU (tab baru); tidak disediakan bila user tak berhak melihatnya, sehingga tombolnya hilang. */
  openBusinessUnitHref?: (id: string) => string | null;
  submitError?: string | null;
  onSubmit: (values: UserFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

interface AssignmentOption {
  value: string;
  label: string;
}

/** Saring opsi daftar kecil yang sudah dimuat penuh menurut teks pencarian (label, tanpa peka huruf besar/kecil). */
function filterByTerm<T>(items: readonly T[], term: string, labelOf: (item: T) => string): T[] {
  const key = normalizeKey(term);
  return key === ''
    ? [...items]
    : items.filter((item) => normalizeKey(labelOf(item)).includes(key));
}

/** `LinkField` satu pilihan untuk baris penugasan: opsi dimuat penuh, pencarian menyaring lokal. */
function AssignmentField({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
  openHref,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: readonly AssignmentOption[];
  onChange: (value: string) => void;
  openHref?: ((id: string) => string | null) | undefined;
}) {
  const [term, setTerm] = useState('');
  return (
    <LinkField
      id={id}
      label={label}
      placeholder={placeholder}
      value={value === '' ? null : value}
      labelOf={(selected) => options.find((option) => option.value === selected)?.label}
      options={filterByTerm(options, term, (option) => option.label).map((option) => ({
        id: option.value,
        label: option.label,
      }))}
      onSearchChange={setTerm}
      searchDebounceMs={0}
      onChange={(next) => onChange(next ?? '')}
      openHref={openHref}
    />
  );
}

/** `LinkMultiField` role untuk baris penugasan: role dipilih sebagai chip; opsi menyaring lokal. */
function RoleAssignmentField({
  id,
  label,
  roles,
  value,
  onChange,
}: {
  id: string;
  label: string;
  roles: readonly RoleDto[];
  value: readonly string[];
  onChange: (roleIds: string[]) => void;
}) {
  const [term, setTerm] = useState('');
  return (
    <div className="space-y-1.5">
      <LinkMultiField
        id={id}
        label={label}
        placeholder="Pilih role…"
        value={value}
        labelOf={(roleId) =>
          roles.find((role) => role.id === roleId)?.name ?? '(role tidak dikenal)'
        }
        options={filterByTerm(roles, term, (role) => role.name).map((role) => ({
          id: role.id,
          label: role.name,
        }))}
        onSearchChange={setTerm}
        searchDebounceMs={0}
        onChange={onChange}
      />
      {roles.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada role.</p> : null}
    </div>
  );
}

export function UserForm({
  mode,
  defaultValues,
  roles,
  locations,
  businessUnits,
  openBusinessUnitHref,
  submitError,
  onSubmit,
  onCancel,
}: UserFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: userFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(userFormSchema.parse(value));
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
      <form.Field name="email">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={field.state.value}
              disabled={mode === 'edit'}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Nama</Label>
            <Input
              id="user-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="status">
        {(field) => (
          <Select
            id="user-status"
            label="Status"
            options={[
              { value: 'active', label: 'Aktif' },
              { value: 'inactive', label: 'Nonaktif' },
            ]}
            value={field.state.value}
            onValueChange={(next) => field.handleChange(next as UserFormInput['status'])}
          />
        )}
      </form.Field>
      <form.Field name="assignments">
        {(field) => {
          const rows = field.state.value;
          const used = new Set(rows.map((row) => row.locationId));
          const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
            field.handleChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
          const optionsFor = (current: string) => [
            ...(used.has(ALL_LOCATIONS_KEY) && current !== ALL_LOCATIONS_KEY
              ? []
              : [{ value: ALL_LOCATIONS_KEY, label: 'Semua lokasi' }]),
            ...locations
              .filter(
                (location) =>
                  (location.status === 'active' || location.id === current) &&
                  (!used.has(location.id) || location.id === current),
              )
              .map((location) => ({
                value: location.id,
                label:
                  location.status === 'active'
                    ? `${location.name} (${location.code})`
                    : `${location.name} (${location.code}) — nonaktif`,
              })),
            ...(current !== '' &&
            current !== ALL_LOCATIONS_KEY &&
            !locations.some((location) => location.id === current)
              ? [{ value: current, label: '(lokasi tidak dikenal)' }]
              : []),
          ];
          return (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Penugasan lokasi</legend>
              <p className="text-xs text-muted-foreground">
                Hak di tiap lokasi ditentukan oleh role penugasannya. Pengaturan Akses hanya berlaku
                dari penugasan Semua lokasi.
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada penugasan.</p>
              ) : null}
              {rows.map((row, index) => (
                <fieldset
                  // biome-ignore lint/suspicious/noArrayIndexKey: baris penugasan tidak punya id stabil
                  key={index}
                  aria-label={`Penugasan ${index + 1}`}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <AssignmentField
                        id={`assign-location-${index}`}
                        label={`Lokasi penugasan ${index + 1}`}
                        placeholder="Pilih lokasi…"
                        value={row.locationId}
                        options={optionsFor(row.locationId)}
                        onChange={(locationId) => update(index, { locationId })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus penugasan ${index + 1}`}
                      onClick={() => field.handleChange(rows.filter((_, i) => i !== index))}
                    >
                      Hapus
                    </Button>
                  </div>
                  <RoleAssignmentField
                    id={`assign-roles-${index}`}
                    label={`Role penugasan ${index + 1}`}
                    roles={roles}
                    value={row.roleIds}
                    onChange={(roleIds) => update(index, { roleIds })}
                  />
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.handleChange([...rows, { locationId: '', roleIds: [] }])}
              >
                Tambah penugasan
              </Button>
              <FieldError stacked errors={field.state.meta.errors} />
            </fieldset>
          );
        }}
      </form.Field>
      <form.Field name="buAssignments">
        {(field) => {
          const rows = field.state.value;
          const used = new Set(rows.map((row) => row.buId));
          const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
            field.handleChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
          const optionsFor = (current: string) => [
            ...(used.has(ALL_BU_KEY) && current !== ALL_BU_KEY
              ? []
              : [{ value: ALL_BU_KEY, label: 'Semua BU' }]),
            ...businessUnits
              .filter(
                (unit) =>
                  (unit.status === 'active' || unit.id === current) &&
                  (!used.has(unit.id) || unit.id === current),
              )
              .map((unit) => ({
                value: unit.id,
                label:
                  unit.status === 'active'
                    ? `${unit.name} (${unit.code})`
                    : `${unit.name} (${unit.code}) — nonaktif`,
              })),
            ...(current !== '' &&
            current !== ALL_BU_KEY &&
            !businessUnits.some((unit) => unit.id === current)
              ? [{ value: current, label: '(BU tidak dikenal)' }]
              : []),
          ];
          return (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Penugasan BU</legend>
              <p className="text-xs text-muted-foreground">
                Hak BU berlaku sama di semua lokasi; hanya modul ber-BU (Data Item) yang dibaca dari
                role di sini. User tanpa penugasan BU tidak melihat item apa pun.
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada penugasan BU.</p>
              ) : null}
              {rows.map((row, index) => (
                <fieldset
                  // biome-ignore lint/suspicious/noArrayIndexKey: baris penugasan tidak punya id stabil
                  key={index}
                  aria-label={`Penugasan BU ${index + 1}`}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <AssignmentField
                        id={`assign-bu-${index}`}
                        label={`BU penugasan ${index + 1}`}
                        placeholder="Pilih BU…"
                        value={row.buId}
                        options={optionsFor(row.buId)}
                        onChange={(buId) => update(index, { buId })}
                        openHref={
                          openBusinessUnitHref
                            ? (id) => (id === ALL_BU_KEY ? null : openBusinessUnitHref(id))
                            : undefined
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus penugasan BU ${index + 1}`}
                      onClick={() => field.handleChange(rows.filter((_, i) => i !== index))}
                    >
                      Hapus
                    </Button>
                  </div>
                  <RoleAssignmentField
                    id={`bu-assign-roles-${index}`}
                    label={`Role penugasan BU ${index + 1}`}
                    roles={roles}
                    value={row.roleIds}
                    onChange={(roleIds) => update(index, { roleIds })}
                  />
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.handleChange([...rows, { buId: '', roleIds: [] }])}
              >
                Tambah penugasan BU
              </Button>
              <FieldError stacked errors={field.state.meta.errors} />
            </fieldset>
          );
        }}
      </form.Field>
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
