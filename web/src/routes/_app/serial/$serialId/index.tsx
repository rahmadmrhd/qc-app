import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { SerialDetailPage } from '@/modules/serial/components/serial-detail-page';
import { SERIAL_TABS } from '@/modules/serial/lib/detail-tabs';
import { serialDetailQueryOptions } from '@/modules/serial/queries';

const searchSchema = z.object({
  /** Id laporan yang dibuka di tab Riwayat (dari daftar Laporan atau tautan "sudah ada laporan aktif"). */
  case: z.string().min(1).optional().catch(undefined),
  tab: z.enum(SERIAL_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/serial/$serialId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(serialDetailQueryOptions(params.serialId ?? '').queryKey)?.serial
          .serial ?? 'Detail',
    }),
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(serialDetailQueryOptions(params.serialId)),
  component: SerialDetailRoute,
});

function SerialDetailRoute() {
  const { serialId } = Route.useParams();
  const { case: caseId, tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  return (
    <SerialDetailPage
      key={serialId}
      serialId={serialId}
      {...(caseId ? { caseId } : {})}
      // `?case=` tanpa `tab` membuka Riwayat (linimasa laporan itu).
      tab={tab ?? (caseId ? 'riwayat' : undefined)}
      // Berpindah tab = mengganti isi halaman yang sama (replace), bukan langkah riwayat baru.
      onTabChange={(next) =>
        void navigate({
          from: Route.fullPath,
          to: '.',
          search: (prev) => ({ ...prev, tab: next }),
          replace: true,
        })
      }
      onBack={() => stack.pop({ to: '/serial' })}
    />
  );
}
