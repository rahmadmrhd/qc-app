import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { qrDefaultsQueryOptions, useSaveQrPreset } from '@/modules/qrcode/queries';
import type { QrFormOutput, QrPresetFieldErrors } from '@/modules/qrcode/schemas';
import {
  QR_PRESET_FIELD_KEYS,
  toPresetFormValues,
  toSaveQrPresetInput,
} from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/default/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: NewQrPresetPage,
});

function NewQrPresetPage() {
  const navigate = useNavigate();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const save = useSaveQrPreset();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrPresetFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrPresetInput(values));
      toast.success('Konfigurasi default disimpan');
      await navigate({ to: '/qrcode/default' });
    } catch (error) {
      const picked = pickFieldErrors(error, QR_PRESET_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <QrDesignForm
        mode="defaults"
        title="Konfigurasi default baru"
        defaultValues={toPresetFormValues()}
        logoLibrary={defaults.logoFileIds}
        businessUnits={businessUnits}
        takenBuIds={new Set(defaults.presets.map((preset) => preset.buId))}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode/default' })}
      />
    </div>
  );
}
