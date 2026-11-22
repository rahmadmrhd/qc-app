import type { RoleDto, SaveRoleInput } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { describeError } from '@/lib/api/describe-error';
import { toRoleFormDefaults } from '../schemas';
import { RoleForm } from './role-form';

export const ROLE_FORM_ID = 'role-form';

export interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Role yang diubah; kosong = role baru. */
  role?: RoleDto | undefined;
  /** Menyimpan; melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: SaveRoleInput) => Promise<unknown>;
}

function RoleDialogBody({
  role,
  onSave,
  onClose,
  onBusyChange,
}: {
  role: RoleDto | undefined;
  onSave: RoleFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(values: Omit<SaveRoleInput, 'id'>) {
    setSubmitError(null);
    try {
      await onSave(role ? { ...values, id: role.id } : values);
      onClose();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  return (
    <RoleForm
      formId={ROLE_FORM_ID}
      defaultValues={toRoleFormDefaults(role)}
      submitError={submitError}
      onSubmit={handleSubmit}
      onBusyChange={onBusyChange}
    />
  );
}

/**
 * Dialog tambah/ubah role (`FormDialogShell`): halaman Role, View role, dan baris "Tambah role" pada penugasan di form
 * pengguna (dirender di luar `<form>` pemanggil; Escape menutup dialog teratas saja).
 */
export function RoleFormDialog({ open, onOpenChange, role, onSave }: RoleFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={ROLE_FORM_ID}
      title={role ? `Ubah role ${role.name}` : 'Tambah role'}
      size="lg"
      submitting={busy}
    >
      {open ? (
        <RoleDialogBody
          key={role?.id ?? 'new'}
          role={role}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
