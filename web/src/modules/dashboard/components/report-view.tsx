import {
  type DashboardGroupId,
  GROUP_FILTERS,
  GROUP_LABELS,
  type WidgetId,
  widgetMeta,
} from '@shared/dashboard';
import type { DashboardReportDto } from '@shared/dashboard-report';
import { REPORT_PERIOD_LABELS, scheduleLabel } from '@shared/dashboard-report';
import type { DashboardShareDto, ShareStatus, ShareWidgetScope } from '@shared/dashboard-share';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { useMe } from '@/modules/auth/use-me';
import { formatNumber, formatWhen } from '../lib/format';
import {
  reportPreviewQueryOptions,
  reportQueryOptions,
  reportsQueryOptions,
  useRemoveReport,
  useSendTestReport,
  useSetReportEnabled,
} from '../report-queries';
import { buFilterOptions, locationFilterOptions } from './global-filters';
import { ReportEnabledBadge, ReportStatusBadge } from './report-status-badge';

const SHARE_STATUS_LABEL: Record<ShareStatus, string> = {
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  revoked: 'Dicabut',
};
const SHARE_STATUS_COLOR = {
  active: 'success',
  expired: 'secondary',
  revoked: 'destructive',
} as const;
const GROUP_ORDER = Object.keys(GROUP_LABELS) as DashboardGroupId[];

/** Laporan tak ada: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Tautan disalin');
  } catch {
    toast.error('Tautan tidak dapat disalin');
  }
}

/** Widget dikelompokkan menurut grup; filter enum berlabel, filter relasi hanya jumlahnya (nama ada di daftar pemilih). */
function groupedWidgets(widgets: readonly ShareWidgetScope[]) {
  const byGroup = new Map<DashboardGroupId, { id: string; title: string; filters: string[] }[]>();
  for (const widget of widgets) {
    let meta: ReturnType<typeof widgetMeta>;
    try {
      meta = widgetMeta(widget.id as WidgetId);
    } catch {
      continue;
    }
    const filters = GROUP_FILTERS[meta.group].flatMap((field) => {
      const values = widget.filters[field.key] ?? [];
      if (values.length === 0) return [];
      if (field.kind === 'enum') {
        const labels = values.map(
          (value) => field.options?.find((option) => option.value === value)?.label ?? value,
        );
        return [`${field.label}: ${labels.join(', ')}`];
      }
      return [`${field.label}: ${values.length} dipilih`];
    });
    const list = byGroup.get(meta.group) ?? [];
    list.push({ id: widget.id, title: meta.title, filters });
    byGroup.set(meta.group, list);
  }
  return GROUP_ORDER.flatMap((group) => {
    const list = byGroup.get(group);
    return list ? [{ group, label: GROUP_LABELS[group], widgets: list }] : [];
  });
}

function Summary({ report }: { report: DashboardReportDto }) {
  return (
    <section aria-label="Ringkasan laporan">
      <DetailList
        items={[
          { label: 'Nama', value: report.name },
          { label: 'Pemilik', value: report.owner },
          { label: 'Status', value: <ReportEnabledBadge enabled={report.enabled} /> },
          { label: 'Jadwal', value: scheduleLabel(report.schedule) },
          { label: 'Periode', value: REPORT_PERIOD_LABELS[report.period] },
          {
            label: 'Pengiriman berikutnya',
            value: report.nextRunAt ? formatWhen(report.nextRunAt) : undefined,
            hidden: !report.enabled,
          },
          {
            label: 'Hasil terakhir',
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                <ReportStatusBadge status={report.lastStatus} />
                {report.lastRunAt ? (
                  <span className="text-muted-foreground">{formatWhen(report.lastRunAt)}</span>
                ) : null}
              </span>
            ),
          },
          { label: 'Catatan hasil', value: report.lastNote, hidden: report.lastNote === '' },
          { label: 'Jumlah penerima', value: formatNumber(report.recipientCount) },
          { label: 'Masa berlaku tautan', value: `${report.linkDays} hari` },
        ]}
      />
    </section>
  );
}

function ScopeSection({ report }: { report: DashboardReportDto }) {
  const me = useMe();
  const buOptions = buFilterOptions(me);
  const locationOptions = locationFilterOptions(me);
  const names = (ids: readonly string[], options: { id: string; label: string }[]) =>
    ids.map((id) => options.find((option) => option.id === id)?.label ?? 'Tidak dikenal');
  const groups = groupedWidgets(report.scope.widgets);
  return (
    <div className="space-y-4">
      <DetailList
        items={[
          {
            label: 'Business Unit',
            value: names(report.scope.buIds, buOptions).join(', ') || 'Tidak ada',
            hidden: !report.canEdit,
          },
          {
            label: 'Lokasi',
            value: names(report.scope.locationIds, locationOptions).join(', ') || 'Tidak dibatasi',
            hidden: !report.canEdit,
          },
          {
            label: 'Pembatasan lokasi',
            value: report.scope.locationFiltered
              ? 'Juga berlaku untuk Serial dan Laporan'
              : undefined,
            hidden: !report.scope.locationFiltered,
          },
        ]}
      />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Widget</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada widget.</p>
        ) : (
          groups.map((entry) => (
            <section key={entry.group} aria-label={entry.label} className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">{entry.label}</h4>
              <ul className="space-y-1 text-sm">
                {entry.widgets.map((widget) => (
                  <li key={widget.id}>
                    {widget.title}
                    {widget.filters.length > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {widget.filters.join(' · ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function RecipientsSection({ report }: { report: DashboardReportDto }) {
  if (report.recipients.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada penerima.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {report.recipients.map((address) => (
        <li key={address}>{address}</li>
      ))}
    </ul>
  );
}

/**
 * Pratinjau surel: HTML yang dihitung server saat diminta, ditampilkan di `iframe` ber-`sandbox` TANPA izin apa pun
 * (tanpa skrip, tanpa form, tanpa navigasi) lewat `srcdoc`. Tombol di dalamnya mengarah ke tautan contoh yang tak
 * berfungsi. Dimuat hanya saat diminta karena menghitung semua widget.
 */
function PreviewSection({ reportId }: { reportId: string }) {
  const [requested, setRequested] = useState(false);
  const preview = useQuery({ ...reportPreviewQueryOptions(reportId), enabled: requested });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Tampilan surel dengan data saat ini. Tidak ada yang dikirim dan tidak ada tautan yang
        dibuat; tombol di dalamnya hanya contoh.
      </p>
      {requested ? null : (
        <Button type="button" variant="outline" color="primary" onClick={() => setRequested(true)}>
          Muat pratinjau
        </Button>
      )}
      {requested && preview.isPending ? (
        <p className="text-sm text-muted-foreground">Menghitung pratinjau…</p>
      ) : null}
      {requested && preview.isError ? (
        <Alert color="destructive">
          <AlertDescription className="space-y-2">
            <span className="block">{describeError(preview.error)}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              color="primary"
              onClick={() => void preview.refetch()}
            >
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.data ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Subjek:</span> {preview.data.subject}
          </p>
          <iframe
            title="Pratinjau surel"
            sandbox=""
            srcDoc={preview.data.html}
            referrerPolicy="no-referrer"
            style={{ background: '#ffffff' }}
            className="h-[640px] w-full rounded-lg border"
          />
        </div>
      ) : null}
    </div>
  );
}

function LinksSection({ links }: { links: readonly DashboardShareDto[] }) {
  const columns: DataColumn<DashboardShareDto>[] = [
    {
      id: 'createdAt',
      header: 'Dikirim',
      mobile: 'title',
      cell: (share) => (
        <LinkCell to="/dashboard/tautan/$shareId" params={{ shareId: share.id }}>
          {formatWhen(share.createdAt)}
        </LinkCell>
      ),
    },
    { id: 'expiresAt', header: 'Berlaku sampai', cell: (share) => formatWhen(share.expiresAt) },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (share) => (
        <Badge variant="soft" color={SHARE_STATUS_COLOR[share.status]}>
          {SHARE_STATUS_LABEL[share.status]}
        </Badge>
      ),
    },
    {
      id: 'copy',
      header: 'Tautan',
      cell: (share) =>
        share.url ? (
          <ActionButton
            action="copy"
            compact
            label="Salin tautan"
            onClick={() => void copyUrl(share.url ?? '')}
          />
        ) : (
          '—'
        ),
    },
  ];
  return (
    <div className="space-y-2">
      <DataTable
        rows={links}
        rowKey={(share) => share.id}
        columns={columns}
        label="Tautan yang pernah dikirim"
        fit="content"
        empty="Belum ada tautan: tautan dibuat saat surel pertama dikirim."
      />
      <p className="text-xs text-muted-foreground">
        Menampilkan 10 tautan terbaru. Tautan lama dihapus otomatis 30 hari setelah kedaluwarsa.
      </p>
    </div>
  );
}

export interface ReportViewProps {
  reportId: string;
  /** Kembali ke daftar (juga setelah menghapus). */
  onBack: () => void;
  onEdit: () => void;
}

/**
 * View satu laporan terjadwal (kit CRUD, `ViewPage` tanpa tab): ringkasan, cakupan, penerima, pratinjau surel, dan
 * tautan yang pernah dikirim. Aksi (Ubah, Jeda/Lanjutkan, Kirim uji, Hapus) hanya bagi pemilik atau super admin
 * (`canEdit`); pemegang `manage` lain hanya melihat metadata. Panel samping: pemilik dan log aktivitas.
 */
export function ReportView({ reportId, onBack, onEdit }: ReportViewProps) {
  const detail = useQuery(reportQueryOptions(reportId));
  // Status SMTP datang dari daftar (DTO `get` tidak membawanya); hanya dimuat bagi yang dapat mengirim uji.
  const list = useQuery({ ...reportsQueryOptions(), enabled: detail.data?.canEdit === true });
  const smtpConfigured = list.data?.smtpConfigured ?? true;
  const setEnabled = useSetReportEnabled();
  const remove = useRemoveReport();
  const sendTest = useSendTestReport();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report = detail.data;

  if (detail.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (detail.isError || !report) {
    const missing = isMissing(detail.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Laporan tidak ditemukan' : 'Laporan tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(detail.error)}
          </p>
        )}
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar laporan
        </Button>
      </PageContent>
    );
  }

  const toggle = () =>
    setEnabled.mutate(
      { id: report.id, enabled: !report.enabled },
      {
        onSuccess: () => toast.success(report.enabled ? 'Laporan dijeda' : 'Laporan dilanjutkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  const test = () =>
    sendTest.mutate(report.id, {
      onSuccess: () => toast.success('Surel uji dikirim ke surel pemilik'),
      onError: (error) => toast.error(describeError(error)),
    });
  const doDelete = () =>
    remove.mutate(report.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        toast.success('Laporan dihapus');
        onBack();
      },
      onError: (error) => {
        setConfirmDelete(false);
        toast.error(describeError(error));
      },
    });

  return (
    <>
      <ViewPage
        title={report.name}
        badge={<ReportEnabledBadge enabled={report.enabled} />}
        actionItems={[
          { id: 'edit', action: 'edit', primary: true, hidden: !report.canEdit, onSelect: onEdit },
          {
            id: 'toggle',
            action: report.enabled ? 'pause' : 'resume',
            primary: true,
            hidden: !report.canEdit,
            busy: setEnabled.isPending,
            onSelect: toggle,
          },
          {
            id: 'sendTest',
            action: 'sendTest',
            hidden: !report.canEdit,
            busy: sendTest.isPending,
            disabled: !smtpConfigured,
            ...(smtpConfigured ? {} : { disabledReason: 'SMTP belum diatur di server' }),
            onSelect: test,
          },
          {
            id: 'delete',
            action: 'delete',
            hidden: !report.canEdit,
            onSelect: () => setConfirmDelete(true),
          },
        ]}
        aside={
          <>
            <ViewMeta createdBy={report.owner} createdAt={report.createdAt} />
            <ActivityLog kind="dashboardReport" id={report.id} createdAt={report.createdAt} />
          </>
        }
      >
        {report.canEdit ? null : (
          <Alert color="info">
            <AlertDescription>
              Hanya pemilik laporan yang dapat mengubahnya, melihat penerima dan pratinjau, atau
              melihat tautan yang dikirim. Anda melihat metadata laporan.
            </AlertDescription>
          </Alert>
        )}
        <ViewSection title="Ringkasan">
          <Summary report={report} />
        </ViewSection>
        <ViewSection title="Cakupan">
          <ScopeSection report={report} />
        </ViewSection>
        {report.canEdit ? (
          <>
            <ViewSection title="Penerima">
              <RecipientsSection report={report} />
            </ViewSection>
            <ViewSection title="Pratinjau surel">
              <PreviewSection reportId={report.id} />
            </ViewSection>
            <ViewSection title="Tautan yang dikirim">
              <LinksSection links={report.links ?? []} />
            </ViewSection>
          </>
        ) : null}
      </ViewPage>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={1}
        subject="laporan terjadwal"
        permanent
        usage="Tautan yang pernah dikirim lewat laporan ini ikut dicabut."
        onConfirm={doDelete}
        busy={remove.isPending}
      />
    </>
  );
}
