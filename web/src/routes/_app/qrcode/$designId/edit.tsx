import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';
import {
  qrDesignQueryOptions,
  qrDesignsQueryOptions,
  useSaveQrDesign,
} from '@/modules/qrcode/queries';
import type { QrFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import { QR_FIELD_KEYS, toQrFormDefaults, toSaveQrDesignInput } from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/$designId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'edit'),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qrDesignQueryOptions(params.designId)),
      context.queryClient.ensureQueryData(qrDesignsQueryOptions()),
    ]),
  component: EditQrDesignPage,
});

function EditQrDesignPage() {
  const { designId } = Route.useParams();
  const navigate = useNavigate();
  const { data: design } = useSuspenseQuery(qrDesignQueryOptions(designId));
  // Versi saat halaman dibuka: unggah PDF/refetch tidak me-reset form; bila orang lain sudah menyimpan,
  // server menjawab CONFLICT (bukan ketikan pengguna hilang diam-diam).
  const loadedAt = useFrozen(design.updatedAt);
  const loaded = useFrozen(design);
  const { data: designs } = useSuspenseQuery(qrDesignsQueryOptions());
  const save = useSaveQrDesign();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrDesignInput(values, design.id, loadedAt));
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
      <h1 className="text-2xl font-semibold">Ubah konfigurasi: {design.title}</h1>
      <QrDesignForm
        key={loadedAt}
        defaultValues={toQrFormDefaults(loaded)}
        initialDocument={
          design.linkSource === 'pdf'
            ? {
                id: design.documentId,
                name: design.documentName,
                link: design.link,
                uses: design.documentUses,
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
