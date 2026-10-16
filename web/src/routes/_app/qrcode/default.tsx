import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { QrDesignForm } from '@/modules/qrcode/components/qr-design-form';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';
import { qrDefaultsQueryOptions, useSaveQrDefaults } from '@/modules/qrcode/queries';
import type { QrDefaultsFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import {
  QR_DEFAULTS_FIELD_KEYS,
  toQrDefaultsFormValues,
  toSaveQrDefaultsInput,
} from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/default')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
  component: QrDefaultsPage,
});

function QrDefaultsPage() {
  const navigate = useNavigate();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  // Versi saat halaman dibuka: unggah logo/refetch tidak me-reset form; bila pengelola lain sudah menyimpan,
  // server menjawab CONFLICT.
  const loadedAt = useFrozen(defaults.updatedAt);
  const loaded = useFrozen(defaults);
  const save = useSaveQrDefaults();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrDefaultsFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrDefaultsInput(values, loadedAt));
      toast.success('Konfigurasi default disimpan');
      await navigate({ to: '/qrcode' });
    } catch (error) {
      const picked = pickFieldErrors(error, QR_DEFAULTS_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <QrDesignForm
        mode="defaults"
        title="Konfigurasi default QR"
        key={loadedAt}
        defaultValues={toQrDefaultsFormValues(loaded)}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/qrcode' })}
      />
      <p className="text-sm text-muted-foreground">
        Nilai awal untuk QR baru (semua isian kecuali sumber link) dan pustaka logo yang dapat
        dipilih user. Mengubah default tidak mengubah QR yang sudah dibuat. Halaman ini hanya
        menyimpan pengaturan, tanpa hasil ekspor.
      </p>
    </div>
  );
}
