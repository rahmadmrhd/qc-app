import type { SaveUserInput, UserDto } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '../lib/field-errors';
import { statusLockReason } from '../lib/protected-user';
import { toUserFormDefaults, type UserFormOutput } from '../schemas';
import { UserForm, type UserFormProps } from './user-form';

export const USER_FORM_ID = 'user-form';

/** Prop referensi (pilihan, tautan, "Tambah") yang diteruskan apa adanya ke `UserForm`. */
export type UserFormReferenceProps = Pick<
  UserFormProps,
  | 'roles'
  | 'locations'
  | 'businessUnits'
  | 'deletedNames'
  | 'openBusinessUnitHref'
  | 'openLocationHref'
  | 'openRoleHref'
  | 'onCreateLocation'
  | 'onCreateRole'
  | 'onCreateBusinessUnit'
>;

export interface UserFormDialogProps extends UserFormReferenceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pengguna yang diubah; kosong = pengguna baru. */
  user?: UserDto | undefined;
  /** Email akun yang sedang masuk: akun sendiri tak dapat dinonaktifkan lewat form. */
  currentEmail?: string | undefined;
  /** Menyimpan; melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: SaveUserInput) => Promise<unknown>;
}

function UserDialogBody({
  user,
  currentEmail,
  onSave,
  onClose,
  onBusyChange,
  ...references
}: UserFormReferenceProps & {
  user: UserDto | undefined;
  currentEmail?: string | undefined;
  onSave: UserFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; name?: string }>({});

  async function handleSubmit(values: UserFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await onSave(user ? { ...values, id: user.id } : values);
      onClose();
    } catch (error) {
      const picked = pickFieldErrors(error, ['email', 'name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <UserForm
      {...references}
      formId={USER_FORM_ID}
      mode={user ? 'edit' : 'create'}
      statusLockReason={
        user && currentEmail !== undefined ? statusLockReason(user, currentEmail) : undefined
      }
      defaultValues={toUserFormDefaults(
        user,
        references.roles.map((role) => role.id),
      )}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onBusyChange={onBusyChange}
    />
  );
}

/**
 * Dialog tambah/ubah pengguna (`FormDialogShell` + `FormTabs`: Identitas, Penugasan lokasi, Penugasan BU). Dipakai
 * halaman Pengguna dan View pengguna. Isian dan galat dibuang tiap dialog ditutup.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSave,
  ...references
}: UserFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={USER_FORM_ID}
      title={user ? `Ubah pengguna ${user.email}` : 'Tambah pengguna'}
      size="lg"
      submitting={busy}
    >
      {open ? (
        <UserDialogBody
          {...references}
          key={user?.id ?? 'new'}
          user={user}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
