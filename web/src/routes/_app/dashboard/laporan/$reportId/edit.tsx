import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportFormPage } from '@/modules/dashboard/components/report-form-page';
import { reportQueryOptions } from '@/modules/dashboard/report-queries';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';

export const Route = createFileRoute('/_app/dashboard/laporan/$reportId/edit')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const name = queryClient.getQueryData(
        reportQueryOptions(params.reportId ?? '').queryKey,
      )?.name;
      return [
        { label: name ?? 'Laporan', to: '/dashboard/laporan/$reportId', params },
        { label: 'Ubah' },
      ];
    },
    pageWidth: 'narrow',
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'edit'),
  // Hanya yang boleh mengelola baris ini (`canEdit` dari server) yang mengubah: yang lain diarahkan ke View.
  loader: async ({ context, params }) => {
    const report = await context.queryClient.ensureQueryData(reportQueryOptions(params.reportId));
    if (!report.canEdit) {
      throw redirect({
        to: '/dashboard/laporan/$reportId',
        params: { reportId: params.reportId },
        replace: true,
      });
    }
    return report;
  },
  component: EditReportRoute,
});

function EditReportRoute() {
  const { reportId } = Route.useParams();
  const stack = useStackNavigation();
  const { data } = useSuspenseQuery(reportQueryOptions(reportId));
  // Versi saat halaman dibuka: muat ulang di latar tak me-reset isian; orang lain yang sudah menyimpan = versi usang.
  const report = useFrozen(data);
  return (
    <ReportFormPage
      report={report}
      onDone={(id) => stack.pop({ to: '/dashboard/laporan/$reportId', params: { reportId: id } })}
      onCancel={() => stack.pop({ to: '/dashboard/laporan/$reportId', params: { reportId } })}
    />
  );
}
