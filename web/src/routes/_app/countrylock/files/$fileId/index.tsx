import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { FileEditorPage } from '@/modules/countrylock-admin/components/file-editor-page';
import { fileQueryOptions } from '@/modules/countrylock-admin/queries';

export const Route = createFileRoute('/_app/countrylock/files/$fileId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(fileQueryOptions(params.fileId ?? '').queryKey)?.path ?? 'Berkas',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  // Berkas yang tak ada ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(fileQueryOptions(params.fileId)).catch(() => undefined),
  component: FileRoute,
});

function FileRoute() {
  const { fileId } = Route.useParams();
  const stack = useStackNavigation();
  return (
    <FileEditorPage
      key={fileId}
      fileId={fileId}
      onBack={() => stack.pop({ to: '/countrylock/files' })}
    />
  );
}
