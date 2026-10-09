import type { ItemSummaryDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/rpc/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ItemsTable } from '@/modules/item/components/items-table';
import { filterItems } from '@/modules/item/lib/filter-items';
import { itemsQueryOptions, useSetItemStatus } from '@/modules/item/queries';

const itemsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/item/')({
  validateSearch: (search: Record<string, unknown>) => itemsSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(itemsQueryOptions()),
  component: ItemsPage,
});

function ItemsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canEdit = can(me, 'item', 'edit');
  const canManage = can(me, 'item', 'manage');
  const { data: items } = useSuspenseQuery(itemsQueryOptions());
  const setStatus = useSetItemStatus();
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  const visible = filterItems(items, { q: search.q ?? '', status: search.status ?? 'all' });

  function toggleStatus(item: ItemSummaryDto) {
    const status = item.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: item.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Item diaktifkan' : 'Item dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Data Item</h1>
        {canEdit ? (
          <Button onClick={() => void navigate({ to: '/item/new' })}>Tambah item</Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari merk, tipe, atau nama lain"
          aria-label="Cari item"
          value={text}
          onChange={(event) => setText(event.target.value)}
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
      <ItemsTable
        items={visible}
        canEdit={canEdit}
        canManage={canManage}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onOpen={(item) => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
        onEdit={(item) => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
        onToggleStatus={toggleStatus}
      />
    </div>
  );
}
