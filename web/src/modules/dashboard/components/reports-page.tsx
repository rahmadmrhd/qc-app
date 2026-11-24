import type { DashboardReportDto } from '@shared/dashboard-report';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  reportsQueryOptions,
  useRemoveReport,
  useSendTestReport,
  useSetReportEnabled,
} from '../report-queries';
import { ReportsTable } from './reports-table';

export type ReportStateFilter = 'all' | 'active' | 'paused';

const STATE_OPTIONS: { value: ReportStateFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'active', label: 'Aktif' },
  { value: 'paused', label: 'Dijeda' },
];

export interface ReportsPageProps {
  q: string;
  state: ReportStateFilter;
  onSearchChange: (patch: {
    q?: string | undefined;
    state?: ReportStateFilter | undefined;
  }) => void;
}

type DeleteTarget = { kind: 'row'; report: DashboardReportDto };

/**
 * Daftar laporan terjadwal (kit CRUD): cari dan filter status di klien (daftar kecil: maks. 20 per pemilik), aksi baris
 * (Ubah, Jeda/Lanjutkan, Kirim uji, Hapus) dan aksi massal Jeda/Lanjutkan. Peringatan bila SMTP belum diatur
 * (penjadwal tak mengirim apa pun). Hanya `dashboard: manage` (dijaga rute).
 */
export function ReportsPage({ q, state, onSearchChange }: ReportsPageProps) {
  const stack = useStackNavigation();
  const list = useQuery(reportsQueryOptions());
  const setEnabled = useSetReportEnabled();
  const remove = useRemoveReport();
  const sendTest = useSendTestReport();
  const selection = useRowSelection(JSON.stringify({ q, state }));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(q, (value) => onSearchChange({ q: value || undefined }));

  const all = list.data?.reports ?? [];
  const needle = text.trim().toLowerCase();
  const visible = all.filter(
    (report) =>
      (needle === '' || report.name.toLowerCase().includes(needle)) &&
      (state === 'all' || (state === 'active') === report.enabled),
  );
  const byId = new Map(all.map((report) => [report.id, report]));
  const reload = () => void list.refetch();

  const pauseBulk = useBulkAction({
    selection,
    subject: 'laporan',
    verb: 'dijeda',
    eligible: (id) => {
      const report = byId.get(id);
      return report?.canEdit === true && report.enabled;
    },
    send: async (ids) =>
      Promise.all(ids.map((id) => setEnabled.mutateAsync({ id, enabled: false }))),
    undo: {
      label: 'Lanjutkan',
      run: (ids) => Promise.all(ids.map((id) => setEnabled.mutateAsync({ id, enabled: true }))),
    },
    reload,
  });
  const resumeBulk = useBulkAction({
    selection,
    subject: 'laporan',
    verb: 'dilanjutkan',
    eligible: (id) => {
      const report = byId.get(id);
      return report?.canEdit === true && !report.enabled;
    },
    send: async (ids) =>
      Promise.all(ids.map((id) => setEnabled.mutateAsync({ id, enabled: true }))),
    reload,
  });
  const bulkBusy = pauseBulk.busy || resumeBulk.busy;

  const toggle = (report: DashboardReportDto) =>
    setEnabled.mutate(
      { id: report.id, enabled: !report.enabled },
      {
        onSuccess: () => toast.success(report.enabled ? 'Laporan dijeda' : 'Laporan dilanjutkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  const sendTestRow = (report: DashboardReportDto) =>
    sendTest.mutate(report.id, {
      onSuccess: () => toast.success('Surel uji dikirim ke surel Anda'),
      onError: (error) => toast.error(describeError(error)),
    });
  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    remove.mutate(target.report.id, {
      onSuccess: () => toast.success('Laporan dihapus'),
      onError: (error) => toast.error(describeError(error)),
      onSettled: () => setDeleteTarget(null),
    });
  };

  const pendingId =
    setEnabled.isPending && setEnabled.variables
      ? setEnabled.variables.id
      : remove.isPending && remove.variables
        ? remove.variables
        : sendTest.isPending && sendTest.variables
          ? sendTest.variables
          : null;
  const stateLabel = STATE_OPTIONS.find((option) => option.value === state)?.label;
  const filtered = needle !== '' || state !== 'all';
  const smtpConfigured = list.data?.smtpConfigured ?? true;
  const goNew = () => stack.push({ to: '/dashboard/laporan/new' });
  const limit = list.data?.limit;
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} laporan` : undefined;

  return (
    <>
      <ListPage
        title="Laporan terjadwal"
        count={countLabel}
        createAction={{ label: 'Tambah laporan', onClick: goNew }}
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama laporan',
              label: 'Cari laporan',
            }}
          >
            <FilterChip
              label="Status"
              display={state === 'all' ? null : stateLabel}
              onClear={() => onSearchChange({ state: undefined })}
            >
              <Select
                id="report-filter-state"
                label="Filter status"
                hideLabel
                options={STATE_OPTIONS}
                value={state}
                onValueChange={(next) =>
                  onSearchChange({
                    state: next === 'all' ? undefined : (next as ReportStateFilter),
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
            {pauseBulk.eligibleCount > 0 ? (
              <ActionButton action="pause" onClick={() => void pauseBulk.run()} />
            ) : null}
            {resumeBulk.eligibleCount > 0 ? (
              <ActionButton action="resume" onClick={() => void resumeBulk.run()} />
            ) : null}
          </BulkBar>
        }
      >
        {smtpConfigured ? null : (
          <Alert color="warning" className="mb-3">
            <AlertDescription>
              SMTP belum diatur di server, jadi laporan tidak terkirim dan Kirim uji tidak dapat
              dipakai. Hubungi admin server.
            </AlertDescription>
          </Alert>
        )}
        <p className="mb-3 text-sm text-muted-foreground">
          Surel berisi ringkasan dashboard yang dikirim sesuai jadwal ke alamat yang Anda tentukan,
          dihitung dari hak pemilik laporan.
          {limit ? ` Maksimal ${limit} laporan per pemilik.` : ''}
        </p>
        <ReportsTable
          reports={visible}
          selection={selection}
          busyId={pendingId}
          smtpConfigured={smtpConfigured}
          onEdit={(report) =>
            stack.push({ to: '/dashboard/laporan/$reportId/edit', params: { reportId: report.id } })
          }
          onToggle={toggle}
          onSendTest={sendTestRow}
          onDelete={(report) => setDeleteTarget({ kind: 'row', report })}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onSearchChange({ q: undefined, state: undefined });
          }}
          emptyAction={
            filtered ? undefined : (
              <Button type="button" onClick={goNew}>
                Buat laporan terjadwal pertama
              </Button>
            )
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={1}
        subject="laporan terjadwal"
        permanent
        usage="Tautan yang pernah dikirim lewat laporan ini ikut dicabut."
        onConfirm={confirmDelete}
        busy={remove.isPending}
      />
    </>
  );
}
