import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportPage } from '@/modules/serial/components/report-page';

export const Route = createFileRoute('/_app/serial/report')({
  staticData: { crumb: 'Lapor Rusak', pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: ReportRoute,
});

function ReportRoute() {
  const stack = useStackNavigation();
  return (
    <ReportPage
      onCancel={() => stack.pop({ to: '/serial' })}
      onOpenSerial={(id, caseId) =>
        stack.replace({
          to: '/serial/$serialId',
          params: { serialId: id },
          ...(caseId ? { search: { case: caseId } } : {}),
        })
      }
    />
  );
}
