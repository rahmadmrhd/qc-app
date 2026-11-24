import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  type DashboardRouteSearch,
  type DashboardSearch,
  parseDashboardSearch,
} from '@/modules/dashboard/lib/search';
import { PublicDashboardPage } from '@/modules/dashboard-public/public-page';

/**
 * Halaman publik dashboard: SENGAJA di luar layout `_app` (tanpa `beforeLoad` yang memanggil `auth.me` atau mengalihkan
 * ke login) dan tanpa loader. Tanpa sesi tetap tampil; tautan tidak pernah memberi izin. Filter penonton ada di search
 * param (nama yang sama dengan halaman Dashboard biasa).
 */
export const Route = createFileRoute('/dashboard-publik/$token')({
  // Kunci filter grup dinamis ikut di objek hasil; router hanya melihat kunci tetapnya (`DashboardRouteSearch`).
  validateSearch: (search: Record<string, unknown>): DashboardRouteSearch =>
    parseDashboardSearch(search),
  component: PublicDashboardRoute,
});

function PublicDashboardRoute() {
  const { token } = Route.useParams();
  const search = Route.useSearch() as DashboardSearch;
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <PublicDashboardPage
      token={token}
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
