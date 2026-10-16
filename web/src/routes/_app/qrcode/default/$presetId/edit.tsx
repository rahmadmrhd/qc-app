import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';
import { qrDefaultsQueryOptions, useSaveQrPreset } from '@/modules/qrcode/queries';
import type { QrFormOutput, QrPresetFieldErrors } from '@/modules/qrcode/schemas';
import {
  QR_PRESET_FIELD_KEYS,
  toPresetFormValues,
  toSaveQrPresetInput,
} from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/default/$presetId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
  component: EditQrPresetPage,
});

function EditQrPresetPage() {
  const { presetId } = Route.useParams();
  const navigate = useNavigate();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const preset = defaults.presets.find((item) => item.id === presetId);
  // Versi saat halaman dibuka: refetch (mis. setelah unggah) tidak me-reset form; bila pengelola lain sudah
  // menyimpan, server menjawab CONFLICT.
  const loadedAt = useFrozen(preset?.updatedAt ?? '');
  const loaded = useFrozen(preset);
  const save = useSaveQrPreset();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrPresetFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrPresetInput(values, presetId, loadedAt));
      toast.success('Konfigurasi default disimpan');
      await navigate({ to: '/qrcode/default' });
    } catch (error) {
      const picked = pickFieldErrors(error, QR_PRESET_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  if (!preset || !loaded) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Konfigurasi default tidak ditemukan.{' '}
        <Link to="/qrcode/default" className="underline">
          Kembali ke daftar
        </Link>
      </p>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <QrDesignForm
        mode="defaults"
        title={`Ubah default: ${loaded.name}`}
        key={loadedAt}
        defaultValues={toPresetFormValues(loaded)}
        logoLibrary={defaults.logoFileIds}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode/default' })}
      />
    </div>
  );
}
