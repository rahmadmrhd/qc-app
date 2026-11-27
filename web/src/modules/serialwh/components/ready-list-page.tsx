import { formatBuLabel } from '@shared/business-units';
import type { WarehouseReadyDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { ListPage } from '@/components/page/list-page';
import { Badge } from '@/components/ui/badge';
import { formatDay } from '@/modules/serial/lib/labels';
import { readyFilterOfSearch, tabSwitchPatch } from '../lib/orders-filter';
import { warehouseReadyListQueryOptions } from '../queries';
import { DISPATCH_STATUS } from './dispatch-section';
import { HistoryTabs } from './history-tabs';
import { OrdersFilters } from './orders-filters';
import type { OrdersPageProps } from './orders-page';

/**
 * Tab "Ready" Riwayat Gudang: satu baris per pencatatan ready (tanpa SO). Kolom tanggal (tautan ke detail), BU, Tipe,
 * jumlah Serial Number, pencatat, dan status; tanpa No SO dan customer.
 */
export function ReadyListPage({ search, onSearchChange }: OrdersPageProps) {
  const filter = readyFilterOfSearch(search);
  const list = useInfiniteQuery(warehouseReadyListQueryOptions(filter));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Object.keys(filter).length > 0;

  const columns: DataColumn<WarehouseReadyDto>[] = [
    {
      id: 'date',
      header: 'Tanggal',
      mobile: 'title',
      cell: (ready) => (
        <LinkCell to="/serial/gudang/riwayat/ready/$readyId" params={{ readyId: ready.id }}>
          {formatDay(ready.dispatchedOn)}
        </LinkCell>
      ),
    },
    {
      id: 'bu',
      header: 'BU',
      cell: (ready) => formatBuLabel({ code: ready.buCode, name: ready.buName }),
    },
    { id: 'item', header: 'Tipe', cell: (ready) => ready.itemLabel },
    { id: 'serials', header: 'Serial', cell: (ready) => ready.serialTotal },
    { id: 'by', header: 'Pencatat', cell: (ready) => ready.createdBy },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (ready) => (
        <Badge variant="soft" color={DISPATCH_STATUS[ready.status].color}>
          {DISPATCH_STATUS[ready.status].label}
        </Badge>
      ),
    },
  ];

  return (
    <ListPage
      title="Riwayat Gudang"
      count={
        list.isSuccess && (items.length > 0 || filtered)
          ? `${items.length}${list.hasNextPage ? '+' : ''} catatan`
          : undefined
      }
      filters={
        <>
          <HistoryTabs
            tab="ready"
            onChange={(tab) => onSearchChange(tabSwitchPatch(tab, search))}
          />
          <OrdersFilters search={search} onChange={onSearchChange} rows={[]} mode="ready" />
        </>
      }
    >
      <DataTable
        rows={items}
        rowKey={(ready) => ready.id}
        columns={columns}
        label="Daftar pencatatan ready"
        rowTo={(ready) => ({
          to: '/serial/gudang/riwayat/ready/$readyId',
          params: { readyId: ready.id },
        })}
        empty="Belum ada pencatatan ready."
        filtered={filtered}
        onClearFilters={() =>
          onSearchChange({ buIds: undefined, from: undefined, to: undefined, status: undefined })
        }
        isLoading={list.isPending}
        isError={list.isLoadingError}
        onRetry={() => void list.refetch()}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        loadMoreError={list.isFetchNextPageError}
        onLoadMore={() => void list.fetchNextPage()}
      />
    </ListPage>
  );
}
