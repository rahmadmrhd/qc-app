import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { qrDesignsQueryOptions, useSaveQrDesign } from '@/modules/qrcode/queries';
import type { QrFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import {
  QR_FIELD_KEYS,
  toDuplicateDefaults,
  toQrFormDefaults,
  toSaveQrDesignInput,
} from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/new')({
  validateSearch: (search: Record<string, unknown>): { from?: string } =>
    typeof search.from === 'string' ? { from: search.from } : {},
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDesignsQueryOptions()),
  component: NewQrDesignPage,
});

function NewQrDesignPage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const { data: designs } = useSuspenseQuery(qrDesignsQueryOptions());
  const save = useSaveQrDesign();
  const source = from ? designs.find((design) => design.id === from) : undefined;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrDesignInput(values));
      toast.success('Konfigurasi disimpan');
      await navigate({ to: '/qrcode' });
    } catch (error) {
      const picked = pickFieldErrors(error, QR_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">
        {source ? 'Duplikat konfigurasi' : 'Konfigurasi QR baru'}
      </h1>
      <QrDesignForm
        defaultValues={source ? toDuplicateDefaults(source) : toQrFormDefaults()}
        initialDocument={
          source?.linkSource === 'pdf'
            ? {
                id: source.documentId,
                name: source.documentName,
                link: source.link,
                uses: source.documentUses,
              }
            : null
        }
        designs={designs}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode' })}
      />
    </div>
  );
}
