import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { can, requireAnyPermission } from '@/modules/auth/permissions';
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
  const me = useMe();
  return (
    <SerialListPage
      search={search}
      onSearchChange={(patch) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
      onOpen={(id) => void navigate({ to: '/serial/$serialId', params: { serialId: id } })}
      onNew={can(me, 'serial', 'edit') ? () => void navigate({ to: '/serial/new' }) : undefined}
    />
  );
}
