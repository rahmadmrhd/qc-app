import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportPage } from '@/modules/serial/components/report-page';

export const Route = createFileRoute('/_app/serial/report')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: ReportRoute,
});

function ReportRoute() {
  const navigate = useNavigate();
  return (
    <ReportPage
      onOpenSerial={(id, caseId) =>
        void navigate({
          to: '/serial/$serialId',
          params: { serialId: id },
          ...(caseId ? { search: { case: caseId } } : {}),
        })
      }
    />
  );
}
