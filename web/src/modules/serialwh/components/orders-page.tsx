import { formatBuLabel } from '@shared/business-units';
import type { WarehouseOrderSummaryDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { ListPage } from '@/components/page/list-page';
import { Badge } from '@/components/ui/badge';
import { formatDay } from '@/modules/serial/lib/labels';
import {
  type OrdersSearchParams,
  ordersFilterOfSearch,
  tabSwitchPatch,
} from '../lib/orders-filter';
import { warehouseOrdersQueryOptions } from '../queries';
import { HistoryTabs } from './history-tabs';
import { OrdersFilters } from './orders-filters';
import { ReadyListPage } from './ready-list-page';

export type OrdersSearch = OrdersSearchParams;

export interface OrdersPageProps {
  search: OrdersSearch;
  onSearchChange: (patch: Partial<OrdersSearch>) => void;
}

/**
 * Riwayat Gudang (kit CRUD): satu baris per catatan SO. Kolom No SO (tautan ke detail), BU, Customer, jumlah
 * pengeluaran, jumlah Serial Number, tanggal keluar terakhir, status ("Belum selesai" bila ada pengeluaran yang belum
 * semua potongannya terkirim), dan jumlah task Serah Terima tertaut. Tanpa pilihan massal.
 */
export function OrdersPage({ search, onSearchChange }: OrdersPageProps) {
  if (search.tab === 'ready') {
    return <ReadyListPage search={search} onSearchChange={onSearchChange} />;
  }
  return <OrdersListPage search={search} onSearchChange={onSearchChange} />;
}

function OrdersListPage({ search, onSearchChange }: OrdersPageProps) {
  const filter = ordersFilterOfSearch(search);
  const list = useInfiniteQuery(warehouseOrdersQueryOptions(filter));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Object.keys(filter).length > 0;

  const columns: DataColumn<WarehouseOrderSummaryDto>[] = [
    {
      id: 'number',
      header: 'No SO',
      mobile: 'title',
      cell: (order) => (
        <LinkCell to="/serial/gudang/riwayat/$orderId" params={{ orderId: order.id }}>
          {order.number}
        </LinkCell>
      ),
    },
    {
      id: 'bu',
      header: 'BU',
      cell: (order) => formatBuLabel({ code: order.buCode, name: order.buName }),
    },
    { id: 'customer', header: 'Customer', cell: (order) => order.customerName || '—' },
    { id: 'dispatches', header: 'Pengeluaran', cell: (order) => order.dispatchCount },
    { id: 'serials', header: 'Serial', cell: (order) => order.serialCount },
    {
      id: 'last',
      header: 'Terakhir',
      cell: (order) => (order.lastDispatchedOn ? formatDay(order.lastDispatchedOn) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (order) =>
        order.hasPending ? (
          <Badge variant="soft" color="warning">
            Belum selesai
          </Badge>
        ) : (
          <Badge variant="soft" color="success">
            Selesai
          </Badge>
        ),
    },
    { id: 'handovers', header: 'Task', cell: (order) => order.handoverCount },
  ];

  return (
    <ListPage
      title="Riwayat Gudang"
      count={
        list.isSuccess && (items.length > 0 || filtered)
          ? `${items.length}${list.hasNextPage ? '+' : ''} SO`
          : undefined
      }
      filters={
        <>
          <HistoryTabs
            tab="order"
            onChange={(tab) => onSearchChange(tabSwitchPatch(tab, search))}
          />
          <OrdersFilters search={search} onChange={onSearchChange} rows={items} />
        </>
      }
    >
      <DataTable
        rows={items}
        rowKey={(order) => order.id}
        columns={columns}
        label="Daftar catatan SO"
        rowTo={(order) => ({
          to: '/serial/gudang/riwayat/$orderId',
          params: { orderId: order.id },
        })}
        empty="Belum ada Keluar Gudang yang tercatat."
        filtered={filtered}
        onClearFilters={() =>
          onSearchChange({
            q: undefined,
            customerIds: undefined,
            buIds: undefined,
            from: undefined,
            to: undefined,
            status: undefined,
          })
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
