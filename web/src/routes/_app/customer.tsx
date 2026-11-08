import type { CustomerDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CustomersManager } from '@/modules/customer/components/customers-manager';
import {
  customersQueryOptions,
  useRenameCustomer,
  useSetCustomerStatus,
} from '@/modules/customer/queries';

export const Route = createFileRoute('/_app/customer')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(customersQueryOptions()),
  component: CustomersPage,
});

function CustomersPage() {
  const me = useMe();
  const { data: customers } = useSuspenseQuery(customersQueryOptions());
  const rename = useRenameCustomer();
  const setStatus = useSetCustomerStatus();

  async function handleRename(input: { id: string; name: string }): Promise<string | null> {
    try {
      await rename.mutateAsync(input);
      toast.success('Customer diperbarui');
      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  function toggleStatus(customer: CustomerDto) {
    const status = customer.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: customer.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Customer diaktifkan' : 'Customer dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Customer</h1>
      <p className="text-sm text-muted-foreground">
        Customer baru dibuat otomatis saat task serah terima disimpan. Mengganti nama berlaku ke
        semua task customer itu; customer tidak dihapus, hanya dinonaktifkan.
      </p>
      <CustomersManager
        customers={customers}
        canManage={can(me, 'item', 'manage')}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onRename={handleRename}
        onToggleStatus={toggleStatus}
      />
    </div>
  );
}
