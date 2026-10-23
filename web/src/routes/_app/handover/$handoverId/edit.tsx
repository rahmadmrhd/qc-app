import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { canAt, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import { readableLocationIds } from '@/modules/handover/lib/readable-locations';
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
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: EditHandoverPage,
});

function EditHandoverPage() {
  const { handoverId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const detail = useQuery(handoverQueryOptions(handoverId, readableLocationIds(me, selectedIds)));
  const locationId = detail.data?.locationId;
  const options = useQuery(handoverOptionsQueryOptions(locationId ? [locationId] : []));
  const save = useSaveHandover();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});

  const back = () => void navigate({ to: '/handover/$handoverId', params: { handoverId } });

  async function handleSubmit(values: HandoverFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveHandoverInput(values, handoverId, task?.updatedAt));
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
    <div className="max-w-3xl space-y-4">
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !task ? (
        <p role="alert" className="text-sm text-destructive">
          Task tidak ditemukan di lokasi aktif.{' '}
          <Link to="/handover" className="underline">
            Kembali ke daftar
          </Link>
        </p>
      ) : !editable ? (
        <p role="alert" className="text-sm text-destructive">
          Task ini tidak dapat diubah (sudah dibatalkan atau Anda tidak punya izin ubah).{' '}
          <Link to="/handover/$handoverId" params={{ handoverId }} className="underline">
            Kembali
          </Link>
        </p>
      ) : options.isPending || !options.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <HandoverForm
          key={task.updatedAt}
          title={`Ubah task ${task.number}`}
          mode="edit"
          locationName={me.locations.find((location) => location.id === task.locationId)?.name}
          defaultValues={toHandoverFormDefaults(task)}
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
