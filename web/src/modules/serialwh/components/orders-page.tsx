import { formatBuLabel } from '@shared/business-units';
import type { WarehouseDispatchListItemDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { ListPage } from '@/components/page/list-page';
import { Badge } from '@/components/ui/badge';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { canUseWarehouse } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { formatDay } from '@/modules/serial/lib/labels';
import { dispatchFilterOfSearch, type OrdersSearchParams } from '../lib/orders-filter';
import { warehouseDispatchesQueryOptions } from '../queries';
import { DISPATCH_STATUS } from './dispatch-section';
import { OrdersFilters } from './orders-filters';

export type OrdersSearch = OrdersSearchParams;

export interface OrdersPageProps {
  search: OrdersSearch;
  onSearchChange: (patch: Partial<OrdersSearch>) => void;
}

/** Task Serah Terima tertaut: nomor menaut ke task hanya bila terbaca; selain itu hanya teks. */
function HandoverNumbers({ handovers }: { handovers: WarehouseDispatchListItemDto['handovers'] }) {
  if (handovers.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {handovers.map((handover) =>
        handover.readable ? (
          <Link
            key={handover.id}
            to="/handover/$handoverId"
            params={{ handoverId: handover.id }}
            className="text-info-text underline-offset-4 hover:underline"
          >
            {handover.number}
          </Link>
        ) : (
          <span key={handover.id} title="Tidak ada akses ke task ini">
            {handover.number}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * Riwayat Gudang (kit CRUD): satu baris per pengeluaran, Penjualan dan Ready Stock digabung. No Riwayat menaut ke
 * detail pengeluaran, No SO (hanya Penjualan) tetap menaut ke detail SO. Tombol "Catat Serial WH" membuka form
 * pencatatan bagi pemegang `serialwh: edit`. Tanpa pilihan massal.
 */
export function OrdersPage({ search, onSearchChange }: OrdersPageProps) {
  const me = useMe();
  const stack = useStackNavigation();
  const filter = dispatchFilterOfSearch(search);
  const list = useInfiniteQuery(warehouseDispatchesQueryOptions(filter));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Object.keys(filter).length > 0;

  const columns: DataColumn<WarehouseDispatchListItemDto>[] = [
    {
      id: 'number',
      header: 'No Riwayat',
      mobile: 'title',
      cell: (dispatch) => (
        <LinkCell to="/serial/gudang/riwayat/$dispatchId" params={{ dispatchId: dispatch.id }}>
          {dispatch.number}
        </LinkCell>
      ),
    },
    {
      id: 'order',
      header: 'No SO',
      cell: (dispatch) =>
        dispatch.orderId !== '' ? (
          <LinkCell to="/serial/gudang/riwayat/so/$orderId" params={{ orderId: dispatch.orderId }}>
            {dispatch.orderNumber}
          </LinkCell>
        ) : (
          '—'
        ),
    },
    {
      id: 'bu',
      header: 'BU',
      cell: (dispatch) => formatBuLabel({ code: dispatch.buCode, name: dispatch.buName }),
    },
    { id: 'customer', header: 'Customer', cell: (dispatch) => dispatch.customerName || '—' },
    { id: 'item', header: 'Tipe', cell: (dispatch) => dispatch.itemLabel || '—' },
    { id: 'serials', header: 'Serial', cell: (dispatch) => dispatch.serialCount },
    { id: 'date', header: 'Tanggal', cell: (dispatch) => formatDay(dispatch.dispatchedOn) },
    {
      id: 'handovers',
      header: 'Task Serah Terima',
      cell: (dispatch) => <HandoverNumbers handovers={dispatch.handovers} />,
    },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (dispatch) => (
        <Badge variant="soft" color={DISPATCH_STATUS[dispatch.status].color}>
          {DISPATCH_STATUS[dispatch.status].label}
        </Badge>
      ),
    },
  ];

  return (
    <ListPage
      title="Riwayat Gudang"
      count={
        list.isSuccess && (items.length > 0 || filtered)
          ? `${items.length}${list.hasNextPage ? '+' : ''} pengeluaran`
          : undefined
      }
      {...(canUseWarehouse(me)
        ? {
            createAction: {
              label: 'Catat Serial WH',
              kind: 'warehouse' as const,
              onClick: () => stack.push({ to: '/serial/gudang' }),
            },
          }
        : {})}
      filters={<OrdersFilters search={search} onChange={onSearchChange} rows={items} />}
    >
      <DataTable
        rows={items}
        rowKey={(dispatch) => dispatch.id}
        columns={columns}
        label="Daftar pengeluaran Gudang"
        rowTo={(dispatch) => ({
          to: '/serial/gudang/riwayat/$dispatchId',
          params: { dispatchId: dispatch.id },
        })}
        empty="Belum ada pencatatan Gudang."
        filtered={filtered}
        onClearFilters={() =>
          onSearchChange({
            q: undefined,
            kind: undefined,
            customerIds: undefined,
            itemIds: undefined,
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
