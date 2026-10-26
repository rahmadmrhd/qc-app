import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverBatchForm } from '@/modules/handover/components/handover-batch-form';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import {
  handoverOptionsQueryOptions,
  useSaveHandover,
  useSaveHandoverBatch,
} from '@/modules/handover/queries';
import type {
  HandoverBatchFormOutput,
  HandoverFieldErrors,
  HandoverFormOutput,
} from '@/modules/handover/schemas';
import {
  HANDOVER_FIELD_KEYS,
  toHandoverFormDefaults,
  toSaveHandoverBatchInput,
  toSaveHandoverInput,
} from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: NewHandoverPage,
});

type Mode = 'single' | 'bulk';

function NewHandoverPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'handover', 'edit', selectedIds);
  const options = useQuery(handoverOptionsQueryOptions(writable.map((location) => location.id)));
  const save = useSaveHandover();
  const saveBatch = useSaveHandoverBatch();
  const [mode, setMode] = useState<Mode>('single');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});
  const defaultLocation = writable.length === 1 ? (writable[0]?.id ?? '') : '';
  const toList = () => void navigate({ to: '/handover' });

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

  async function handleBatch(values: HandoverBatchFormOutput) {
    // Satu kelompok (<= 10 task, atomik). Galat dilempar ke form bulk: kartu bermasalah ditandai dan kelompok
    // yang sudah tersimpan dilaporkan; navigasi hanya setelah SEMUA kelompok tersimpan (`onSaved`).
    return saveBatch.mutateAsync(toSaveHandoverBatchInput(values));
  }

  function handleBatchSaved(count: number) {
    toast.success(`${count} task disimpan`);
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
        <>
          <fieldset aria-label="Mode penambahan" className="flex gap-1 border-0 p-0">
            <Button
              type="button"
              size="sm"
              variant={mode === 'single' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'single'}
              onClick={() => setMode('single')}
            >
              Satu task
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'bulk' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'bulk'}
              onClick={() => setMode('bulk')}
            >
              Banyak task (bulk)
            </Button>
          </fieldset>
          {/* Keduanya tetap terpasang agar draf tidak hilang saat beralih. */}
          <div hidden={mode !== 'single'}>
            <HandoverForm
              title="Tambah task serah terima"
              mode="create"
              defaultValues={toHandoverFormDefaults(undefined, defaultLocation)}
              options={options.data}
              submitError={submitError}
              fieldErrors={fieldErrors}
              onSubmit={handleSubmit}
              onCancel={toList}
            />
          </div>
          <div hidden={mode !== 'bulk'}>
            <HandoverBatchForm
              options={options.data}
              defaultLocationId={defaultLocation}
              onSubmit={handleBatch}
              onSaved={handleBatchSaved}
              onCancel={toList}
            />
          </div>
        </>
      )}
    </div>
  );
}
