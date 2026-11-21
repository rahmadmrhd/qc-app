import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess } from '@/lib/link-access';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import type { QrSubmitOptions } from '@/modules/qrcode/components/qr-design-form';
import { QrDesignFormPage } from '@/modules/qrcode/components/qr-design-form-page';
import { qrDefaultsQueryOptions, useSaveQrDesign } from '@/modules/qrcode/queries';
import type { QrFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import { QR_FIELD_KEYS, toQrFormDefaults, toSaveQrDesignInput } from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/new')({
  staticData: { crumb: 'Tambah' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
  component: NewQrDesignPage,
});

function NewQrDesignPage() {
  const stack = useStackNavigation();
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
      // Tambah = replace (butir 41c): back dari View tidak kembali ke form yang sudah tersimpan.
      // Tambah = replace ke View konfigurasi baru; "Simpan dan ekspor" membuka dialog ekspor di sana (`?export=1`).
      stack.replace(
        options.thenExport
          ? { to: '/qrcode/$designId', params: { designId: saved.id }, search: { export: '1' } }
          : { to: '/qrcode/$designId', params: { designId: saved.id } },
      );
    } catch (error) {
      const picked = pickFieldErrors(error, QR_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <QrDesignFormPage
      title="Konfigurasi QR baru"
      canExport={can(me, 'qrcode', 'edit')}
      defaultValues={toQrFormDefaults()}
      logoLibrary={defaults.logoFileIds}
      presets={defaults.presets}
      openItemHref={itemLinkAccess(me).openItemHref}
      canCreateItem={itemLinkAccess(me).canCreate}
      canOpenDeletedItem={itemLinkAccess(me).canOpenDeleted}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onCancel={() => stack.pop({ to: '/qrcode' })}
    />
  );
}
