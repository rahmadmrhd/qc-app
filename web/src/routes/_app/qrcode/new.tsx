import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess } from '@/lib/link-access';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import type { QrSubmitOptions } from '@/modules/qrcode/components/qr-design-form';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { qrDefaultsQueryOptions, useSaveQrDesign } from '@/modules/qrcode/queries';
import type { QrFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import { QR_FIELD_KEYS, toQrFormDefaults, toSaveQrDesignInput } from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
  component: NewQrDesignPage,
});

function NewQrDesignPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const save = useSaveQrDesign();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrFieldErrors>({});

  async function handleSubmit(values: QrFormOutput, options: QrSubmitOptions) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await save.mutateAsync(
        toSaveQrDesignInput(values, undefined, undefined, options.overflow),
      );
      toast.success('Konfigurasi disimpan');
      // "Simpan dan ekspor": lanjut ke dialog konfirmasi ekspor di daftar.
      await navigate(
        options.thenExport ? { to: '/qrcode', search: { export: saved.id } } : { to: '/qrcode' },
      );
    } catch (error) {
      const picked = pickFieldErrors(error, QR_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <QrDesignForm
        title="Konfigurasi QR baru"
        canExport={can(me, 'qrcode', 'edit')}
        defaultValues={toQrFormDefaults()}
        logoLibrary={defaults.logoFileIds}
        presets={defaults.presets}
        openItemHref={itemLinkAccess(me).openItemHref}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode' })}
      />
    </div>
  );
}
