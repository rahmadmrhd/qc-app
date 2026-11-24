import type { DashboardReportDto } from '@shared/dashboard-report';
import { REPORT_PERIOD_LABELS, scheduleLabel } from '@shared/dashboard-report';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { formatWhen } from '../lib/format';
import { ReportEnabledBadge, ReportStatusBadge } from './report-status-badge';

export interface ReportsTableProps {
  reports: readonly DashboardReportDto[];
  /** Ada = kolom checkbox (hanya laporan yang boleh diubah pengguna yang dapat dipilih). */
  selection?: RowSelection;
  /** Laporan yang sedang diproses (aksi barisnya dinonaktifkan). */
  busyId?: string | null;
  onEdit: (report: DashboardReportDto) => void;
  onToggle: (report: DashboardReportDto) => void;
  onSendTest: (report: DashboardReportDto) => void;
  onDelete: (report: DashboardReportDto) => void;
  /** Surel uji butuh SMTP; tanpa itu aksinya nonaktif dengan alasan. */
  smtpConfigured: boolean;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel laporan terjadwal (kit CRUD): [checkbox][Aksi][Nama → View][Jadwal][Periode][Penerima][Status][Hasil terakhir]
 * [Pengiriman berikutnya]. Aksi baris (Ubah, Jeda/Lanjutkan, Kirim uji, Hapus) hanya untuk laporan yang boleh diubah
 * pengguna (pemilik atau super admin). Di ponsel menjadi kartu: Nama = judul, Hasil terakhir = badge, sisanya meta.
 */
export function ReportsTable({
  reports,
  selection,
  busyId = null,
  onEdit,
  onToggle,
  onSendTest,
  onDelete,
  smtpConfigured,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
}: ReportsTableProps) {
  const columns: DataColumn<DashboardReportDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (report) => (
        <LinkCell to="/dashboard/laporan/$reportId" params={{ reportId: report.id }}>
          {report.name}
        </LinkCell>
      ),
    },
    { id: 'schedule', header: 'Jadwal', cell: (report) => scheduleLabel(report.schedule) },
    { id: 'period', header: 'Periode', cell: (report) => REPORT_PERIOD_LABELS[report.period] },
    {
      id: 'recipients',
      header: 'Penerima',
      align: 'right',
      cell: (report) => report.recipientCount,
    },
    {
      id: 'enabled',
      header: 'Status',
      cell: (report) => <ReportEnabledBadge enabled={report.enabled} />,
    },
    {
      id: 'status',
      header: 'Hasil terakhir',
      mobile: 'badge',
      cell: (report) => (
        <span className="inline-flex flex-col items-start gap-1">
          <ReportStatusBadge status={report.lastStatus} />
          {report.lastNote ? (
            <span className="text-xs text-muted-foreground">{report.lastNote}</span>
          ) : null}
          {report.lastRunAt ? (
            <span className="text-xs text-muted-foreground">{formatWhen(report.lastRunAt)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Pengiriman berikutnya',
      className: 'text-sm text-muted-foreground',
      cell: (report) => (report.nextRunAt ? formatWhen(report.nextRunAt) : '—'),
    },
  ];

  const actions = (report: DashboardReportDto): RowAction[] => {
    const busy = busyId === report.id;
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${report.name}`,
        shortLabel: 'Ubah',
        hidden: !report.canEdit,
        disabled: busy,
        onSelect: () => onEdit(report),
      },
      {
        id: 'toggle',
        action: report.enabled ? 'pause' : 'resume',
        label: `${report.enabled ? 'Jeda' : 'Lanjutkan'} ${report.name}`,
        shortLabel: report.enabled ? 'Jeda' : 'Lanjutkan',
        hidden: !report.canEdit,
        busy,
        onSelect: () => onToggle(report),
      },
      {
        id: 'sendTest',
        action: 'sendTest',
        label: `Kirim uji ${report.name}`,
        shortLabel: 'Kirim uji',
        hidden: !report.canEdit,
        disabled: busy || !smtpConfigured,
        ...(smtpConfigured ? {} : { disabledReason: 'SMTP belum diatur di server' }),
        onSelect: () => onSendTest(report),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${report.name}`,
        shortLabel: 'Hapus',
        hidden: !report.canEdit,
        disabled: busy,
        onSelect: () => onDelete(report),
      },
    ];
  };

  return (
    <DataTable
      rows={reports}
      rowKey={(report) => report.id}
      columns={columns}
      label="Daftar laporan terjadwal"
      rowTo={(report) => ({ to: '/dashboard/laporan/$reportId', params: { reportId: report.id } })}
      selectLabel={(report) => report.name}
      selection={selection}
      rowSelectable={(report) => report.canEdit}
      actions={actions}
      empty="Belum ada laporan terjadwal."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
