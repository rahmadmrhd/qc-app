import type { RoleDto } from '@shared/rpc';
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
  submitError?: string | null;
  onSubmit: (values: UserFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function UserForm({
  mode,
  defaultValues,
  roles,
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
      <form.Field name="roleIds">
        {(field) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Role</legend>
            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada role.</p>
            ) : null}
            {roles.map((role) => {
              const checked = field.state.value.includes(role.id);
              return (
                <div key={role.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${role.id}`}
                    checked={checked}
                    onCheckedChange={(next) =>
                      field.handleChange(
                        next === true
                          ? [...field.state.value, role.id]
                          : field.state.value.filter((id) => id !== role.id),
                      )
                    }
                  />
                  <Label htmlFor={`role-${role.id}`} className="font-normal">
                    {role.name}
                  </Label>
                </div>
              );
            })}
          </fieldset>
        )}
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
