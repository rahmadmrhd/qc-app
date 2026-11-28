import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { SettingsForm } from '@/modules/countrylock-admin/components/settings-form';
import { filesQueryOptions } from '@/modules/countrylock-admin/queries';

export const Route = createFileRoute('/_app/countrylock/settings')({
  staticData: { pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(filesQueryOptions()),
  component: SettingsRoute,
});

function SettingsRoute() {
  const stack = useStackNavigation();
  return (
    <SettingsForm
      onCancel={() => stack.pop({ to: '/countrylock/files' })}
      onDone={() => stack.pop({ to: '/countrylock/files' })}
    />
  );
}
