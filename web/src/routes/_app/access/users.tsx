import type { UserDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  FormDialog,
  FormDialogContent,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { UserForm } from '@/modules/access/components/user-form';
import { UsersTable } from '@/modules/access/components/users-table';
import { filterUsers } from '@/modules/access/lib/filter-users';
import {
  businessUnitsQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
  usersQueryOptions,
  useSaveUser,
  useSetUserStatus,
} from '@/modules/access/queries';
import type { UserFormOutput } from '@/modules/access/schemas';
import { toUserFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const usersSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/users')({
  validateSearch: (search: Record<string, unknown>) => usersSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(usersQueryOptions()),
      context.queryClient.ensureQueryData(rolesQueryOptions()),
      context.queryClient.ensureQueryData(locationsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
    ]);
  },
  component: UsersPage,
});

function UsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: users } = useSuspenseQuery(usersQueryOptions());
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitsQueryOptions());
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));
  const businessUnitNames = new Map(businessUnits.map((unit) => [unit.id, unit.name]));
  const visible = filterUsers(users, { q: search.q ?? '', status: search.status ?? 'all' });

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: UserFormOutput) {
    setSubmitError(null);
    try {
      await saveUser.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('User disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function toggleStatus(user: UserDto) {
    const status = user.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: user.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'User diaktifkan' : 'User dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Users</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah user</Button> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari email atau nama"
          value={search.q ?? ''}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({ ...prev, q: event.target.value || undefined }),
              replace: true,
            })
          }
        />
        <NativeSelect
          aria-label="Filter status"
          className="sm:w-48"
          value={search.status ?? 'all'}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                status: event.target.value as 'all' | 'active' | 'inactive',
              }),
              replace: true,
            })
          }
        >
          <option value="all">Semua status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </NativeSelect>
      </div>
      <UsersTable
        users={visible}
        roleNames={roleNames}
        locationNames={locationNames}
        businessUnitNames={businessUnitNames}
        canManage={canManage}
        currentEmail={me.email}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onEdit={(user) => setEditing(user)}
        onToggleStatus={toggleStatus}
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      >
        <FormDialogContent>
          <FormDialogHeader>
            <FormDialogTitle>{editing === 'new' ? 'Tambah user' : 'Ubah user'}</FormDialogTitle>
          </FormDialogHeader>
          {editing ? (
            <UserForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toUserFormDefaults(
                editing === 'new' ? undefined : editing,
                roles.map((role) => role.id),
              )}
              roles={roles}
              locations={locations}
              businessUnits={businessUnits}
              openBusinessUnitHref={businessUnitLinkAccess(me).openBusinessUnitHref}
              submitError={submitError}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </FormDialogContent>
      </FormDialog>
    </div>
  );
}
