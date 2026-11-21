import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { canReportSerials, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CaseListPage } from '@/modules/serial/components/case-list-page';
import { caseSearchSchema } from '@/modules/serial/lib/case-filter';

export const Route = createFileRoute('/_app/serial/reports')({
  validateSearch: (search: Record<string, unknown>) => caseSearchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  component: CaseListRoute,
});

function CaseListRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  return (
    <CaseListPage
      search={search}
      onReport={canReportSerials(me) ? () => void navigate({ to: '/serial/report' }) : undefined}
      onSearchChange={(patch) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
      onOpen={(serialId, caseId) =>
        void navigate({
          to: '/serial/$serialId',
          params: { serialId },
          search: { case: caseId },
        })
      }
    />
  );
}
