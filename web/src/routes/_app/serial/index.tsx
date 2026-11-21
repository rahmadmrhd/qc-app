import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { canRecordSerials, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { SerialListPage } from '@/modules/serial/components/serial-list-page';
import { serialSearchSchema } from '@/modules/serial/lib/list-filter';

export const Route = createFileRoute('/_app/serial/')({
  validateSearch: (search: Record<string, unknown>) => serialSearchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  component: SerialListRoute,
});

function SerialListRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const me = useMe();
  return (
    <SerialListPage
      search={search}
      // Filter dan pencarian mengganti isi halaman yang sama (replace), bukan langkah riwayat baru.
      onSearchChange={(patch) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
      onNew={canRecordSerials(me) ? () => stack.push({ to: '/serial/new' }) : undefined}
    />
  );
}
