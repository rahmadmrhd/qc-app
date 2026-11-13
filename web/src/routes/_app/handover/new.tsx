import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverBatchForm } from '@/modules/handover/components/handover-batch-form';
import { handoverOptionsQueryOptions, useSaveHandoverBatch } from '@/modules/handover/queries';
import type { HandoverBatchFormOutput } from '@/modules/handover/schemas';
import { toSaveHandoverBatchInput } from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: NewHandoverPage,
});

function NewHandoverPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'handover', 'edit', selectedIds);
  const options = useQuery(handoverOptionsQueryOptions(writable.map((location) => location.id)));
  const saveBatch = useSaveHandoverBatch();
  const defaultLocation = writable.length === 1 ? (writable[0]?.id ?? '') : '';
  const toList = () => void navigate({ to: '/handover' });

  async function handleBatch(values: HandoverBatchFormOutput) {
    // SATU permintaan atomik (<= 30 task). Galat dilempar ke form bulk: kartu bermasalah ditandai dan draf utuh;
    // navigasi hanya setelah semua task tersimpan (`onSaved`).
    return saveBatch.mutateAsync(toSaveHandoverBatchInput(values));
  }

  function handleBatchSaved(count: number) {
    toast.success(count === 1 ? 'Task disimpan' : `${count} task disimpan`);
    toList();
  }

  return (
    <div className="max-w-3xl space-y-4">
      {writable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi aktif terpilih yang boleh Anda ubah. Pilih lokasi di header.
        </p>
      ) : options.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : options.isError || !options.data ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat daftar customer.
        </p>
      ) : (
        <HandoverBatchForm
          options={options.data}
          defaultLocationId={defaultLocation}
          onSubmit={handleBatch}
          onSaved={handleBatchSaved}
          onCancel={toList}
        />
      )}
    </div>
  );
}
