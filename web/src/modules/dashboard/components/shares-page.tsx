import type { DashboardShareDto, ShareStatus } from '@shared/dashboard-share';
import { wibDateIso } from '@shared/postel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { Badge } from '@/components/ui/badge';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { formatDayLabel } from '../lib/format';
import { sharesQueryOptions, useRevokeShare } from '../share-queries';
import { EditShareDialog } from './edit-share-dialog';
import { RevokeShareDialog } from './revoke-share-dialog';

export type ShareStatusFilter = 'all' | ShareStatus;

export const SHARE_STATUS_LABEL: Record<ShareStatus, string> = {
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  revoked: 'Dicabut',
};
const STATUS_COLOR = { active: 'success', expired: 'secondary', revoked: 'destructive' } as const;

const STATUS_OPTIONS: { value: ShareStatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'active', label: SHARE_STATUS_LABEL.active },
  { value: 'expired', label: SHARE_STATUS_LABEL.expired },
  { value: 'revoked', label: SHARE_STATUS_LABEL.revoked },
];

const dayOf = (iso: string): string => formatDayLabel(wibDateIso(Date.parse(iso)));

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Tautan disalin');
  } catch {
    toast.error('Tautan tidak dapat disalin');
  }
}

export interface SharesPageProps {
  q: string;
  status: ShareStatusFilter;
  onSearchChange: (patch: {
    q?: string | undefined;
    status?: ShareStatusFilter | undefined;
  }) => void;
}

/**
 * Daftar semua tautan publik dashboard, baik yang dibagikan manual (tombol Bagikan) maupun terbitan laporan terjadwal.
 * Pemegang `dashboard: edit` melihat tautannya sendiri; `manage`/super admin semua. Aksi baris: Salin tautan (bila server
 * mengirim `url`), Ubah konfigurasi (tautan manual membuka dialog ubah; terbitan laporan membuka form laporannya), dan
 * Cabut. Cari dan filter status dilakukan di klien (daftar kecil, maks. 50 aktif per pembagi).
 */
export function SharesPage({ q, status, onSearchChange }: SharesPageProps) {
  const stack = useStackNavigation();
  const me = useMe();
  const list = useQuery(sharesQueryOptions());
  const revoke = useRevokeShare();
  const [text, setText] = useUrlSyncedText(q, (value) => onSearchChange({ q: value || undefined }));
  const [revokeTarget, setRevokeTarget] = useState<DashboardShareDto | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const all = list.data ?? [];
  const needle = text.trim().toLowerCase();
  const visible = all.filter(
    (share) =>
      (needle === '' ||
        share.title.toLowerCase().includes(needle) ||
        share.createdBy.toLowerCase().includes(needle)) &&
      (status === 'all' || share.status === status),
  );
  const filtered = needle !== '' || status !== 'all';
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} tautan` : undefined;
  const showOwner = can(me, 'dashboard', 'manage');

  const columns: DataColumn<DashboardShareDto>[] = [
    {
      id: 'title',
      header: 'Nama',
      mobile: 'title',
      cell: (share) => (
        <LinkCell to="/dashboard/tautan/$shareId" params={{ shareId: share.id }}>
          {share.title}
        </LinkCell>
      ),
    },
    {
      id: 'createdBy',
      header: 'Pembagi',
      cell: (share) => share.createdBy,
      ...(showOwner ? {} : { mobile: 'hide' as const }),
    },
    { id: 'createdAt', header: 'Dibuat', cell: (share) => dayOf(share.createdAt) },
    { id: 'expiresAt', header: 'Kedaluwarsa', cell: (share) => dayOf(share.expiresAt) },
    { id: 'widgetCount', header: 'Widget', align: 'right', cell: (share) => share.widgetCount },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (share) => (
        <Badge variant="soft" color={STATUS_COLOR[share.status]}>
          {SHARE_STATUS_LABEL[share.status]}
        </Badge>
      ),
    },
  ];

  const actions = (share: DashboardShareDto): RowAction[] => [
    {
      id: 'copy',
      action: 'copy',
      label: `Salin tautan ${share.title}`,
      shortLabel: 'Salin tautan',
      hidden: share.url === undefined,
      onSelect: () => void copyUrl(share.url ?? ''),
    },
    {
      id: 'edit',
      action: 'edit',
      label: `Ubah konfigurasi ${share.title}`,
      shortLabel: 'Ubah konfigurasi',
      hidden: share.status === 'revoked' || (share.reportId === '' && share.status === 'expired'),
      onSelect: () =>
        share.reportId === ''
          ? setEditId(share.id)
          : stack.push({
              to: '/dashboard/laporan/$reportId/edit',
              params: { reportId: share.reportId },
            }),
    },
    {
      id: 'revoke',
      action: 'delete',
      label: `Cabut tautan ${share.title}`,
      shortLabel: 'Cabut',
      hidden: share.status !== 'active',
      busy: revoke.isPending && revokeTarget?.id === share.id,
      onSelect: () => setRevokeTarget(share),
    },
  ];

  return (
    <>
      <ListPage
        title="Tautan dibagikan"
        count={countLabel}
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama atau pembagi',
              label: 'Cari tautan',
            }}
          >
            <FilterChip
              label="Status"
              display={status === 'all' ? null : statusLabel}
              onClear={() => onSearchChange({ status: undefined })}
            >
              <Select
                id="share-filter-status"
                label="Filter status"
                hideLabel
                options={STATUS_OPTIONS}
                value={status}
                onValueChange={(next) =>
                  onSearchChange({
                    status: next === 'all' ? undefined : (next as ShareStatusFilter),
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Tautan publik dashboard dari tombol Bagikan dan dari laporan terjadwal. Mencabut tautan
          langsung mematikan akses semua pemegangnya.
        </p>
        <DataTable
          rows={visible}
          rowKey={(share) => share.id}
          columns={columns}
          label="Daftar tautan dibagikan"
          selectLabel={(share) => share.title}
          actions={actions}
          rowTo={(share) => ({ to: '/dashboard/tautan/$shareId', params: { shareId: share.id } })}
          empty="Belum ada tautan yang dibagikan."
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onSearchChange({ q: undefined, status: undefined });
          }}
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={() => void list.refetch()}
        />
      </ListPage>
      <RevokeShareDialog
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        revoke={revoke}
      />
      {editId ? <EditShareDialog shareId={editId} onClose={() => setEditId(null)} /> : null}
    </>
  );
}
