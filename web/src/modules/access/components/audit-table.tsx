import type { AuditEntryDto, MeDto } from '@shared/contract';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { auditActionLabel, formatAuditTime } from '../lib/audit-actions';
import { auditTargetLink } from '../lib/audit-link';

export interface AuditTableProps {
  entries: readonly AuditEntryDto[];
  /** Pengguna yang sedang masuk: menentukan target mana yang boleh menjadi tautan (lihat `auditTargetLink`). */
  me: MeDto | null | undefined;
  onSelect: (entry: AuditEntryDto) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel Log Audit (kit CRUD, tanpa checkbox): [Aksi: Lihat detail][Waktu][Pelaku][Aksi audit][Target]. Target menjadi
 * tautan ke View entitasnya bila pengguna berhak (`auditTargetLink`), selain itu teks. Di ponsel menjadi kartu:
 * target = judul, aksi audit = badge, waktu dan pelaku = meta.
 */
export function AuditTable({
  entries,
  me,
  onSelect,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  filtered,
  onClearFilters,
  isLoading,
  isError,
  onRetry,
}: AuditTableProps) {
  const columns: DataColumn<AuditEntryDto>[] = [
    {
      id: 'time',
      header: 'Waktu',
      className: 'whitespace-nowrap',
      cell: (entry) => formatAuditTime(entry.ts),
    },
    { id: 'actor', header: 'Pelaku', cell: (entry) => entry.actor },
    {
      id: 'action',
      header: 'Aksi',
      mobile: 'badge',
      cell: (entry) => (
        <Badge variant="outline" color="primary">
          {auditActionLabel(entry.action)}
        </Badge>
      ),
    },
    {
      id: 'target',
      header: 'Target',
      mobile: 'title',
      cell: (entry) => {
        const link = auditTargetLink(entry, me);
        return link ? (
          <LinkCell to={link.to} params={link.params}>
            {entry.target}
          </LinkCell>
        ) : (
          <span className="font-medium">{entry.target}</span>
        );
      },
    },
  ];

  const actions = (entry: AuditEntryDto): RowAction[] => [
    {
      id: 'view',
      action: 'view',
      label: `Lihat detail ${auditActionLabel(entry.action)} ${entry.target}`,
      onSelect: () => onSelect(entry),
    },
  ];

  return (
    <DataTable
      rows={entries}
      rowKey={(entry) => String(entry.id)}
      columns={columns}
      label="Log audit"
      selectLabel={(entry) => `${auditActionLabel(entry.action)} ${entry.target}`}
      actions={actions}
      empty="Belum ada catatan audit."
      filtered={filtered}
      onClearFilters={onClearFilters}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={onLoadMore}
    />
  );
}
