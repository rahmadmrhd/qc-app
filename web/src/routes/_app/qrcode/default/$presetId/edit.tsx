import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
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
  staticData: {
    crumb: ({ params, queryClient }) => {
      const name = queryClient
        .getQueryData(qrDefaultsQueryOptions().queryKey)
        ?.presets.find((preset) => preset.id === params.presetId)?.name;
      return name ? [{ label: name }, { label: 'Ubah' }] : { label: 'Ubah' };
    },
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: EditQrPresetPage,
});

function EditQrPresetPage() {
  const { presetId } = Route.useParams();
  const navigate = useNavigate();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
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
      <p role="alert" className="text-sm text-destructive-text">
        Konfigurasi default tidak ditemukan.{' '}
        <Link to="/qrcode/default" className="underline">
          Kembali ke daftar
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <QrDesignForm
        mode="defaults"
        title={`Ubah default: ${loaded.name}`}
        key={loadedAt}
        defaultValues={toPresetFormValues(loaded)}
        logoLibrary={defaults.logoFileIds}
        businessUnits={businessUnits}
        takenBuIds={
          new Set(defaults.presets.filter((item) => item.id !== presetId).map((item) => item.buId))
        }
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode/default' })}
      />
    </div>
  );
}
