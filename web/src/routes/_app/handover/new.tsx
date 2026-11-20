import type { HandoverOptionsDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/api-error';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverBatchForm } from '@/modules/handover/components/handover-batch-form';
import { notifyCreateQueued, useSendCreate } from '@/modules/handover/lib/send-create';
import { handoverOptionsQueryOptions } from '@/modules/handover/queries';
import type { HandoverBatchFormOutput } from '@/modules/handover/schemas';
import { toSaveHandoverBatchInput } from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/new')({
  staticData: { crumb: 'Tambah', pageWidth: 'narrow', locationAware: true },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: NewHandoverPage,
});

function NewHandoverPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'handover', 'edit', selectedIds);
  const options = useQuery(handoverOptionsQueryOptions(writable.map((location) => location.id)));
  const sendCreate = useSendCreate(me.email);
  // Hasil kiriman terakhir: diantrekan di perangkat (offline) atau tersimpan di server (menentukan teks toast).
  const queued = useRef(false);
  const defaultLocation = writable.length === 1 ? (writable[0]?.id ?? '') : '';
  // Data ada (walau muat ulang gagal) dipakai apa adanya; server tidak terjangkau tanpa data: formulir tetap tampil
  // dengan saran customer kosong (nama diketik bebas) supaya task baru tetap bisa dibuat offline.
  const formOptions: HandoverOptionsDto | null =
    options.data ??
    (options.error instanceof ApiError && options.error.code === 'UNAVAILABLE'
      ? { customers: [], inactiveCustomerNames: [] }
      : null);
  const toList = () => void navigate({ to: '/handover' });

  async function handleBatch(values: HandoverBatchFormOutput) {
    // SATU permintaan atomik (<= 30 task). Galat dilempar ke form bulk: kartu bermasalah ditandai dan draf utuh;
    // navigasi hanya setelah semua task tersimpan (`onSaved`).
    // Server tidak terjangkau: task diantrekan di perangkat (clientId idempoten) dan dikirim saat tersambung.
    const result = await sendCreate(toSaveHandoverBatchInput(values));
    queued.current = result.queued;
    return result;
  }

  function handleBatchSaved(count: number) {
    if (queued.current) notifyCreateQueued(count);
    else toast.success(count === 1 ? 'Task disimpan' : `${count} task disimpan`);
    toList();
  }

  return (
    <div className="space-y-4">
      {writable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi aktif terpilih yang boleh Anda ubah. Pilih lokasi di header.
        </p>
      ) : options.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !formOptions ? (
        <p role="alert" className="text-sm text-destructive-text">
          Gagal memuat daftar customer.
        </p>
      ) : (
        <HandoverBatchForm
          options={formOptions}
          defaultLocationId={defaultLocation}
          onSubmit={handleBatch}
          onSaved={handleBatchSaved}
          onCancel={toList}
        />
      )}
    </div>
  );
}
