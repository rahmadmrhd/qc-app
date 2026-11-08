import { ALL_LOCATIONS_KEY } from '@shared/assignments';
import type { LocationDto, RoleDto } from '@shared/contract';
import { useForm } from '@tanstack/react-form';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserFormInput, UserFormOutput } from '../schemas';
import { userFormSchema } from '../schemas';

export interface UserFormProps {
  mode: 'create' | 'edit';
  defaultValues: UserFormInput;
  roles: readonly RoleDto[];
  locations: readonly LocationDto[];
  submitError?: string | null;
  onSubmit: (values: UserFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function UserForm({
  mode,
  defaultValues,
  roles,
  locations,
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
          <div className="space-y-1.5">
            <Label htmlFor="user-status">Status</Label>
            <NativeSelect
              id="user-status"
              value={field.state.value}
              onChange={(event) =>
                field.handleChange(event.target.value as UserFormInput['status'])
              }
            >
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </NativeSelect>
          </div>
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
              <legend className="text-sm font-medium">Penugasan</legend>
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
                  <div className="flex items-center gap-2">
                    <NativeSelect
                      aria-label={`Lokasi penugasan ${index + 1}`}
                      value={row.locationId}
                      onChange={(event) => update(index, { locationId: event.target.value })}
                    >
                      {row.locationId === '' ? (
                        <option value="" disabled>
                          Pilih lokasi…
                        </option>
                      ) : null}
                      {optionsFor(row.locationId).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
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
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {roles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Belum ada role.</p>
                    ) : null}
                    {roles.map((role) => (
                      <div key={role.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`assign-${index}-${role.id}`}
                          checked={row.roleIds.includes(role.id)}
                          onCheckedChange={(next) =>
                            update(index, {
                              roleIds:
                                next === true
                                  ? [...row.roleIds, role.id]
                                  : row.roleIds.filter((id) => id !== role.id),
                            })
                          }
                        />
                        <Label htmlFor={`assign-${index}-${role.id}`} className="font-normal">
                          {role.name}
                        </Label>
                      </div>
                    ))}
                  </div>
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
