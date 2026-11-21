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
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';
import {
  qrDefaultsQueryOptions,
  qrDesignQueryOptions,
  useSaveQrDesign,
} from '@/modules/qrcode/queries';
import type { QrFieldErrors, QrFormOutput } from '@/modules/qrcode/schemas';
import {
  QR_FIELD_KEYS,
  toEditContext,
  toQrFormDefaults,
  toSaveQrDesignInput,
} from '@/modules/qrcode/schemas';

export const Route = createFileRoute('/_app/qrcode/$designId/edit')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const name = queryClient.getQueryData(
        qrDesignQueryOptions(params.designId ?? '').queryKey,
      )?.name;
      return name
        ? [
            { label: name, to: '/qrcode/$designId', params: { designId: params.designId ?? '' } },
            { label: 'Ubah' },
          ]
        : { label: 'Ubah' };
    },
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'edit'),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qrDesignQueryOptions(params.designId)),
      context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
    ]),
  component: EditQrDesignPage,
});

function EditQrDesignPage() {
  const { designId } = Route.useParams();
  const stack = useStackNavigation();
  const me = useMe();
  const { data: design } = useSuspenseQuery(qrDesignQueryOptions(designId));
  // Versi saat halaman dibuka: unggah PDF/refetch tidak me-reset form; bila orang lain sudah menyimpan,
  // server menjawab CONFLICT (bukan ketikan pengguna hilang diam-diam).
  const loadedAt = useFrozen(design.updatedAt);
  const loaded = useFrozen(design);
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const save = useSaveQrDesign();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrFieldErrors>({});

  async function handleSubmit(values: QrFormOutput, options: QrSubmitOptions) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveQrDesignInput(values, design.id, loadedAt, options.overflow));
      toast.success('Konfigurasi disimpan');
      // Ubah = kembali ke View asal; "Simpan dan ekspor" membuka dialog ekspor di View (`?export=1`).
      if (options.thenExport) {
        stack.replace({ to: '/qrcode/$designId', params: { designId }, search: { export: '1' } });
      } else stack.pop({ to: '/qrcode/$designId', params: { designId } });
    } catch (error) {
      const picked = pickFieldErrors(error, QR_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <QrDesignFormPage
      title={`Ubah konfigurasi: ${design.title}`}
      canExport={can(me, 'qrcode', 'edit')}
      key={loadedAt}
      defaultValues={toQrFormDefaults(loaded)}
      initialDocument={
        design.linkSource === 'pdf'
          ? {
              id: design.documentId,
              name: design.documentName,
              link: design.link,
            }
          : null
      }
      logoLibrary={defaults.logoFileIds}
      updatePresets={defaults.presets}
      edit={toEditContext(loaded)}
      openItemHref={itemLinkAccess(me).openItemHref}
      canCreateItem={itemLinkAccess(me).canCreate}
      canOpenDeletedItem={itemLinkAccess(me).canOpenDeleted}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onCancel={() => stack.pop({ to: '/qrcode/$designId', params: { designId } })}
    />
  );
}
