import type { SerialCaseRowDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { Badge } from '@/components/ui/badge';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { buIdsWithLevelOf } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  type CaseSearch,
  caseFilterOfSearch,
  effectiveBuIds,
  effectiveCaseStatus,
} from '../lib/case-filter';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL } from '../lib/labels';
import { serialCaseListQueryOptions } from '../queries';
import { SerialStatusBadge } from './serial-status-badge';

export interface CaseListPageProps {
  search: CaseSearch;
  onSearchChange: (patch: Partial<CaseSearch>) => void;
  /** Buka halaman Lapor Rusak; tidak diberikan bagi pengguna tanpa hak menulis serial (tombol tidak tampil). */
  onReport?: (() => void) | undefined;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Laporan aktif' },
  { value: 'closed', label: 'Laporan selesai' },
  { value: 'all', label: 'Semua laporan' },
];

function agoLabel(days: number): string {
  return days <= 0 ? 'Hari ini' : `${days} hari`;
}

const OUTCOME_LABEL = { good: 'Lolos', broken: 'Rusak' } as const;

/**
 * Daftar laporan rusak (kit CRUD; bukan daftar serial): nomor LP (tautan ke halaman detail laporan),
 * serial, item, BU, status, lokasi, lama di status, pelapor, dan ringkasan. Filter status (bawaan aktif) dan BU serta
 * pencarian awalan nomor LP atau serial berada di URL. Tanpa pilihan massal (laporan tidak dihapus). Tim servis (hanya
 * `serialservice`) melihat semua laporan di BU-nya. Di ponsel baris menjadi kartu.
 */
export function CaseListPage({ search, onSearchChange, onReport }: CaseListPageProps) {
  const me = useMe();
  const list = useInfiniteQuery(serialCaseListQueryOptions(caseFilterOfSearch(search)));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const readable = new Set([
    ...buIdsWithLevelOf(me, 'serial', 'view'),
    ...buIdsWithLevelOf(me, 'serialservice', 'view'),
  ]);
  const buOptions: LinkOption[] = (me.businessUnits ?? [])
    .filter((bu) => !bu.deleted && readable.has(bu.id))
    .map((bu) => ({ id: bu.id, label: `${bu.code} · ${bu.name}` }));
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) =>
    onSearchChange({ q: value.trim() === '' ? undefined : value.trim() }),
  );
  const status = effectiveCaseStatus(search);
  const buIds = effectiveBuIds(search);
  const filtered = search.q !== undefined || buIds.length > 0 || status !== 'active';

  const columns: DataColumn<SerialCaseRowDto>[] = [
    {
      id: 'number',
      header: 'Nomor LP',
      mobile: 'title',
      cell: (entry) => (
        <>
          <span className="font-mono">
            <LinkCell to="/serial/reports/$caseId" params={{ caseId: entry.id }} tour="case-open">
              {entry.number}
            </LinkCell>
          </span>
          <div className="text-xs text-muted-foreground">{formatDay(entry.openedOn)}</div>
        </>
      ),
    },
    {
      id: 'serial',
      header: 'Serial Number',
      cell: (entry) => <span className="font-mono">{entry.serial}</span>,
    },
    { id: 'item', header: 'Item', cell: (entry) => entry.itemLabel },
    { id: 'bu', header: 'BU', cell: (entry) => entry.buCode },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (entry) =>
        entry.closedOn && entry.outcome ? (
          <>
            <Badge color={entry.outcome === 'good' ? 'success' : 'destructive'} variant="soft">
              Hasil: {OUTCOME_LABEL[entry.outcome]}
            </Badge>
            <div className="text-xs text-muted-foreground">
              Selesai {formatDay(entry.closedOn)} · status sekarang {STATUS_LABEL[entry.status]}
            </div>
          </>
        ) : (
          <SerialStatusBadge status={entry.status} />
        ),
    },
    {
      id: 'location',
      header: 'Lokasi saat ini',
      cell: (entry) => (
        <>
          {entry.locationName || '—'}
          <div className="text-xs text-muted-foreground">{CUSTODY_LABEL[entry.custody]}</div>
        </>
      ),
    },
    {
      id: 'duration',
      header: 'Lama',
      cell: (entry) =>
        entry.closedOn
          ? `Selesai dalam ${agoLabel(entry.durationDays)}`
          : agoLabel(entry.daysInStatus),
    },
    {
      id: 'reporter',
      header: 'Pelapor',
      className: 'max-w-48 truncate',
      cell: (entry) => <span title={entry.reporter}>{entry.reporter}</span>,
    },
    {
      id: 'summary',
      header: 'Ringkasan',
      className: 'max-w-72 truncate',
      cell: (entry) => <span title={entry.summary}>{entry.summary || '—'}</span>,
    },
  ];

  return (
    <ListPage
      title="Laporan"
      count={
        list.isSuccess && (items.length > 0 || filtered)
          ? `${items.length}${list.hasNextPage ? '+' : ''} laporan`
          : undefined
      }
      createAction={
        onReport ? { label: 'Lapor Rusak', onClick: onReport, tour: 'case-report' } : undefined
      }
      filters={
        <div data-tour="case-filters">
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Awalan nomor LP atau serial',
              label: 'Cari nomor LP atau Serial Number',
            }}
          >
            <FilterChip
              label="Status"
              display={
                status === 'active' ? null : STATUS_OPTIONS.find((o) => o.value === status)?.label
              }
              onClear={() => onSearchChange({ status: undefined })}
            >
              <Select
                id="case-filter-status"
                label="Filter status laporan"
                hideLabel
                options={STATUS_OPTIONS}
                value={status}
                onValueChange={(next) =>
                  onSearchChange({
                    status: next === 'active' ? undefined : (next as CaseSearch['status']),
                  })
                }
              />
            </FilterChip>
            <FilterChip
              label="BU"
              display={multiFilterDisplay(buIds.map(buLabel))}
              onClear={() => onSearchChange({ buIds: undefined, bu: undefined })}
            >
              <LinkMultiField
                id="case-filter-bu"
                label="Filter BU"
                hideLabel
                placeholder="Semua BU"
                localFilter
                highlight
                value={buIds}
                labelOf={buLabel}
                options={buOptions}
                onChange={(next) =>
                  onSearchChange({ buIds: next.length > 0 ? next : undefined, bu: undefined })
                }
              />
            </FilterChip>
          </FilterBar>
        </div>
      }
    >
      <div data-tour="case-table">
        <DataTable
          rows={items}
          rowKey={(entry) => entry.id}
          columns={columns}
          label="Daftar laporan rusak"
          empty={
            onReport
              ? 'Belum ada laporan di sini. Kalau ada unit bermasalah, laporkan lewat tombol Lapor Rusak.'
              : 'Belum ada laporan di sini.'
          }
          filtered={filtered}
          onClearFilters={() =>
            onSearchChange({ q: undefined, buIds: undefined, bu: undefined, status: undefined })
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={() => void list.refetch()}
          hasMore={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          loadMoreError={list.isFetchNextPageError}
          onLoadMore={() => void list.fetchNextPage()}
        />
      </div>
    </ListPage>
  );
}
