import type { HandoverDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { canAt, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
import {
  handoverSearchSchema,
  scopedLocationIds,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';
import {
  handoverOptionsQueryOptions,
  handoverQueryOptions,
  useSaveHandover,
} from '@/modules/handover/queries';
import type { HandoverFieldErrors, HandoverFormOutput } from '@/modules/handover/schemas';
import {
  HANDOVER_FIELD_KEYS,
  toHandoverFormDefaults,
  toSaveHandoverInput,
} from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/edit')({
  staticData: {
    crumb: ({ params, search, queryClient }) => {
      const [hit] = queryClient.getQueriesData<{ number: string }>({
        queryKey: ['handovers', 'one', params.handoverId ?? ''],
      });
      return [
        {
          label: hit?.[1]?.number ?? 'Detail',
          to: '/handover/$handoverId',
          params,
          search: { loc: search.loc, status: search.status },
        },
        { label: 'Ubah' },
      ];
    },
    pageWidth: 'narrow',
  },
  validateSearch: (search: Record<string, unknown>) => handoverSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: EditHandoverPage,
});

function EditHandoverPage() {
  const { handoverId } = Route.useParams();
  const search = Route.useSearch();
  const listSearch = searchFromStatus(statusFromSearch(search), search.loc);
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const detail = useQuery(
    handoverQueryOptions(
      handoverId,
      readableLocationIds(me, scopedLocationIds(search.loc, selectedIds)),
    ),
  );
  const locationId = detail.data?.locationId;
  const options = useQuery(handoverOptionsQueryOptions(locationId ? [locationId] : []));
  const save = useSaveHandover();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});

  const back = () =>
    void navigate({ to: '/handover/$handoverId', params: { handoverId }, search: listSearch });

  // Keadaan task saat form dibuka: dasar `expectedUpdatedAt` dan nilai awal. Muat ulang latar (mis. QC
  // mencentang, atau sambung ulang jaringan) TIDAK me-mount ulang form dan tidak mengganti draf; bentrokan
  // dengan perubahan lain ditangkap server (expectedUpdatedAt + base: hanya centang/komentar yang berubah bukan konflik).
  const baseTask = useRef<HandoverDto | null>(null);
  if (baseTask.current === null && detail.data) baseTask.current = detail.data;

  async function handleSubmit(values: HandoverFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const opened = baseTask.current;
      await save.mutateAsync(
        toSaveHandoverInput(
          values,
          handoverId,
          opened?.updatedAt,
          opened
            ? { note: opened.note, customerId: opened.customerId, status: opened.status }
            : undefined,
        ),
      );
      toast.success('Task disimpan');
      back();
    } catch (error) {
      const picked = pickFieldErrors(error, HANDOVER_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  const task = detail.data;
  const editable =
    task !== undefined &&
    task.status !== 'cancelled' &&
    canAt(me, 'handover', 'edit', task.locationId);
  return (
    <div className="space-y-4">
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !task ? (
        <p role="alert" className="text-sm text-destructive-text">
          Task tidak ditemukan di lokasi aktif.{' '}
          <Link to="/handover" search={listSearch} className="underline">
            Kembali ke daftar
          </Link>
        </p>
      ) : !editable ? (
        <p role="alert" className="text-sm text-destructive-text">
          Task ini tidak dapat diubah (sudah dibatalkan atau Anda tidak punya izin ubah).{' '}
          <Link
            to="/handover/$handoverId"
            params={{ handoverId }}
            search={listSearch}
            className="underline"
          >
            Kembali
          </Link>
        </p>
      ) : options.isPending || !options.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <HandoverForm
          key={task.id}
          title={`Ubah task ${task.number}`}
          mode="edit"
          locationName={me.locations.find((location) => location.id === task.locationId)?.name}
          defaultValues={toHandoverFormDefaults(baseTask.current ?? task)}
          options={options.data}
          submitError={submitError}
          fieldErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={back}
        />
      )}
    </div>
  );
}
