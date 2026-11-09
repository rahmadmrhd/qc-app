import type { RoleDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FormDialog,
  FormDialogContent,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describeError } from '@/lib/api/describe-error';
import { RoleForm } from '@/modules/access/components/role-form';
import { RolesTable } from '@/modules/access/components/roles-table';
import { rolesQueryOptions, useDeleteRole, useSaveRole } from '@/modules/access/queries';
import type { RoleFormOutput } from '@/modules/access/schemas';
import { toRoleFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/roles')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(rolesQueryOptions()),
  component: RolesPage,
});

function RolesPage() {
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const saveRole = useSaveRole();
  const deleteRole = useDeleteRole();
  const [editing, setEditing] = useState<RoleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleDto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: RoleFormOutput) {
    setSubmitError(null);
    try {
      await saveRole.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('Role disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteRole.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          toast.success('Role dihapus');
          setDeleting(null);
        },
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Roles</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah role</Button> : null}
      </div>
      <RolesTable
        roles={roles}
        canManage={canManage}
        onEdit={(role) => setEditing(role)}
        onDelete={setDeleting}
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      >
        <FormDialogContent className="max-h-[90svh] overflow-y-auto">
          <FormDialogHeader>
            <FormDialogTitle>{editing === 'new' ? 'Tambah role' : 'Ubah role'}</FormDialogTitle>
          </FormDialogHeader>
          {editing ? (
            <RoleForm
              key={editing === 'new' ? 'new' : editing.id}
              defaultValues={toRoleFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </FormDialogContent>
      </FormDialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus role?</DialogTitle>
            <DialogDescription>Role "{deleting?.name}" akan dihapus permanen.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Batal
            </Button>
            <Button variant="destructive" disabled={deleteRole.isPending} onClick={confirmDelete}>
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
