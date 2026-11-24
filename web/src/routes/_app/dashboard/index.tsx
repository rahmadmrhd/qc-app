import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DashboardPage } from '@/modules/dashboard/components/dashboard-page';
import {
  type DashboardRouteSearch,
  type DashboardSearch,
  parseDashboardSearch,
} from '@/modules/dashboard/lib/search';

export const Route = createFileRoute('/_app/dashboard/')({
  // Kunci filter grup dinamis ikut di objek hasil; router hanya melihat kunci tetapnya (`DashboardRouteSearch`).
  validateSearch: (search: Record<string, unknown>): DashboardRouteSearch =>
    parseDashboardSearch(search),
  component: DashboardRoute,
});

function DashboardRoute() {
  const search = Route.useSearch() as DashboardSearch;
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DashboardPage
      search={search}
      onSearchChange={(patch) =>
        void navigate({
          search: (prev) => ({ ...prev, ...patch }) as DashboardRouteSearch,
          replace: true,
        })
      }
    />
  );
}
