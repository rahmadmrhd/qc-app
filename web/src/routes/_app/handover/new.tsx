import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { can, locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import { handoverOptionsQueryOptions, useSaveHandover } from '@/modules/handover/queries';
import type { HandoverFieldErrors, HandoverFormOutput } from '@/modules/handover/schemas';
import {
  HANDOVER_FIELD_KEYS,
  toHandoverFormDefaults,
  toSaveHandoverInput,
} from '@/modules/handover/schemas';
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
  const save = useSaveHandover();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});

  async function handleSubmit(values: HandoverFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await save.mutateAsync(toSaveHandoverInput(values));
      toast.success(`Task ${saved.number} disimpan`);
      await navigate({ to: '/handover/$handoverId', params: { handoverId: saved.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, HANDOVER_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
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
          Gagal memuat daftar tipe dan customer.
        </p>
      ) : (
        <HandoverForm
          title="Tambah task serah terima"
          mode="create"
          defaultValues={toHandoverFormDefaults(
            undefined,
            writable.length === 1 ? (writable[0]?.id ?? '') : '',
          )}
          options={options.data}
          createItemLink={
            can(me, 'item', 'edit') ? (
              <Link to="/item/new" className="underline">
                Tambah item baru
              </Link>
            ) : null
          }
          submitError={submitError}
          fieldErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={() => void navigate({ to: '/handover' })}
        />
      )}
    </div>
  );
}
