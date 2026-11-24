import type { RoleDto, SaveRoleInput } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { useFrozen } from '@/hooks/use-frozen';
import { describeSaveError } from '../lib/stale';
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
  role: liveRole,
  onSave,
  onClose,
  onBusyChange,
}: {
  role: RoleDto | undefined;
  onSave: RoleFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // Rekaman dibekukan saat badan dialog terpasang (hanya saat dialog terbuka): isi form dan versi (`updatedAt`) yang dikirim
  // sebagai `expectedUpdatedAt` selalu pasangan yang sama, walau query record dimuat ulang (polling 30 dtk, invalidasi
  // setelah 412). Buka-tutup-buka = rekaman segar.
  const role = useFrozen(liveRole);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(values: Omit<SaveRoleInput, 'id'>) {
    setSubmitError(null);
    try {
      await onSave(role ? { ...values, id: role.id, expectedUpdatedAt: role.updatedAt } : values);
      onClose();
    } catch (error) {
      setSubmitError(describeSaveError(error));
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
