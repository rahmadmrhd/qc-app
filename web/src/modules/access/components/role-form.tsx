import { LEVEL_LABELS, levelHint, levelsFor, MODULE_LABELS, MODULES } from '@shared/permissions';
import { useForm } from '@tanstack/react-form';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RoleFormInput, RoleFormOutput } from '../schemas';
import { roleFormSchema } from '../schemas';

export interface RoleFormProps {
  defaultValues: RoleFormInput;
  submitError?: string | null;
  onSubmit: (values: RoleFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function RoleForm({ defaultValues, submitError, onSubmit, onCancel }: RoleFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: roleFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(roleFormSchema.parse(value));
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
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Nama role</Label>
            <Input
              id="role-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="description">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Deskripsi</Label>
            <Textarea
              id="role-description"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="permissions">
        {(field) => (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Akses per modul</legend>
            {MODULES.map((module) => {
              const current = field.state.value[module] ?? 'none';
              const levels = levelsFor(module);
              return (
                <div key={module} className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">{MODULE_LABELS[module]}</p>
                  <fieldset
                    aria-label={`Level ${MODULE_LABELS[module]}`}
                    className="m-0 grid min-w-0 gap-1 rounded-md bg-muted p-1"
                    style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}
                  >
                    {levels.map((level) => {
                      const active = current === level;
                      return (
                        <Button
                          key={level}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'ghost'}
                          aria-pressed={active}
                          className="h-8 px-1 text-xs"
                          onClick={() =>
                            field.handleChange({ ...field.state.value, [module]: level })
                          }
                        >
                          {LEVEL_LABELS[level]}
                        </Button>
                      );
                    })}
                  </fieldset>
                  <p className="text-xs text-muted-foreground">{levelHint(module, current)}</p>
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
