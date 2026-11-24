import type {
  DashboardReportDto,
  DashboardReportListDto,
  SaveDashboardReportInput,
} from '@shared/dashboard-report';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Kunci laporan terjadwal: di bawah `['dashboard']` tetapi TIDAK masuk whitelist `app/query-persist.ts` (daftar memuat
 * jadwal dan catatan hasil kirim; pratinjau memuat data dari hak pemilik).
 */
export const reportKeys = {
  all: ['dashboard', 'reports'] as const,
  detail: (id: string) => ['dashboard', 'reports', 'detail', id] as const,
  preview: (id: string) => ['dashboard', 'reports', 'preview', id] as const,
};

const HALF_MINUTE_MS = 30_000;

/** Daftar semua laporan (pemegang `dashboard: manage` melihat semuanya; alamat penerima hanya untuk pemilik). */
export function reportsQueryOptions() {
  return queryOptions({
    queryKey: reportKeys.all,
    queryFn: () => api('dashboardReports.list', null),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Detail satu laporan (View dan form ubah); tautan terbitan hanya untuk pemilik dan super admin. */
export function reportQueryOptions(id: string) {
  return queryOptions({
    queryKey: reportKeys.detail(id),
    queryFn: () => api('dashboardReports.get', { id }),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Pratinjau surel: dihitung server saat diminta (tanpa mengirim), jadi tak di-cache lama. */
export function reportPreviewQueryOptions(id: string) {
  return queryOptions({
    queryKey: reportKeys.preview(id),
    queryFn: () => api('dashboardReports.preview', { id }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Menaruh satu laporan hasil server ke daftar dan detail tanpa menunggu muat ulang. */
function useRememberReport() {
  const client = useQueryClient();
  return (report: DashboardReportDto) => {
    client.setQueryData(reportKeys.detail(report.id), report);
    client.setQueryData<DashboardReportListDto>(reportKeys.all, (list) =>
      list
        ? {
            ...list,
            reports: list.reports.some((row) => row.id === report.id)
              ? list.reports.map((row) => (row.id === report.id ? report : row))
              : [report, ...list.reports],
          }
        : list,
    );
    void client.invalidateQueries({ queryKey: reportKeys.all });
  };
}

/** Menyimpan (membuat atau mengubah) laporan; PUT utuh dengan `expectedUpdatedAt` saat mengubah. */
export function useSaveReport() {
  const remember = useRememberReport();
  return useMutation({
    mutationFn: (input: SaveDashboardReportInput) => api('dashboardReports.save', input),
    onSuccess: remember,
  });
}

/** Menjeda atau melanjutkan laporan (idempoten). */
export function useSetReportEnabled() {
  const remember = useRememberReport();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api('dashboardReports.setEnabled', input),
    onSuccess: remember,
  });
}

/** Menghapus laporan (tautan terbitannya dicabut server). */
export function useRemoveReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('dashboardReports.remove', { id }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: reportKeys.detail(id) });
      void client.invalidateQueries({ queryKey: reportKeys.all });
    },
  });
}

/** Kirim uji: satu surel [UJI] ke surel pemilik; daftar dimuat ulang karena riwayat aktivitas bertambah. */
export function useSendTestReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('dashboardReports.sendTest', { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['activity'] }),
  });
}
