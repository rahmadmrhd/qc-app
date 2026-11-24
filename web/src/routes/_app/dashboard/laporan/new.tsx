import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportFormPage } from '@/modules/dashboard/components/report-form-page';

export const Route = createFileRoute('/_app/dashboard/laporan/new')({
  staticData: { crumb: 'Tambah', pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'edit'),
  component: NewReportRoute,
});

function NewReportRoute() {
  const stack = useStackNavigation();
  return (
    <ReportFormPage
      onDone={(id) =>
        stack.replace({ to: '/dashboard/laporan/$reportId', params: { reportId: id } })
      }
      onCancel={() => stack.pop({ to: '/dashboard/laporan' })}
    />
  );
}
