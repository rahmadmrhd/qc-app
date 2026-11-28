import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ImportPage } from '@/modules/countrylock-admin/components/import-page';

export const Route = createFileRoute('/_app/countrylock/import')({
  staticData: { pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  component: ImportRoute,
});

function ImportRoute() {
  const stack = useStackNavigation();
  return <ImportPage onCancel={() => stack.pop({ to: '/countrylock/files' })} />;
}
