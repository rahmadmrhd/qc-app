import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { locationsWith, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoversTable } from '@/modules/handover/components/handovers-table';
import { filterHandovers } from '@/modules/handover/lib/filter-handovers';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
import { handoversQueryOptions } from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z
    .enum(['all', 'active', 'new', 'in_progress', 'done', 'cancelled'])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/handover/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoversPage,
});

function HandoversPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = readableLocationIds(me, selectedIds);
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  const query = useQuery(handoversQueryOptions(readable));
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  const locationNames = new Map(me.locations.map((location) => [location.id, location.name]));
  const visible = filterHandovers(query.data ?? [], {
    q: search.q ?? '',
    status: search.status ?? 'active',
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Serah Terima</h1>
        {canCreate ? (
          <Button onClick={() => void navigate({ to: '/handover/new' })}>Tambah task</Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari nomor, customer, atau catatan"
          aria-label="Cari task"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <NativeSelect
          aria-label="Filter status"
          className="sm:w-52"
          value={search.status ?? 'active'}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({ ...prev, status: event.target.value as typeof search.status }),
              replace: true,
            })
          }
        >
          <option value="active">Aktif (Baru + Dikerjakan)</option>
          <option value="all">Semua status</option>
          <option value="new">Baru</option>
          <option value="in_progress">Dikerjakan</option>
          <option value="done">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </NativeSelect>
      </div>
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
        </p>
      ) : query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat task. Coba muat ulang.
        </p>
      ) : (
        <HandoversTable
          handovers={visible}
          showLocation={readable.length > 1}
          locationNames={locationNames}
          onOpen={(handover) =>
            void navigate({ to: '/handover/$handoverId', params: { handoverId: handover.id } })
          }
        />
      )}
    </div>
  );
}
