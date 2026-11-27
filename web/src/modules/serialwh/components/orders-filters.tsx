import { formatBuLabel } from '@shared/business-units';
import type { WarehouseDispatchListItemDto } from '@shared/contract';
import { WAREHOUSE_KIND_LABEL } from '@shared/serial-warehouse';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { Select } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { buIdsWithLevelOf, canUseWarehouse } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { formatDay } from '@/modules/serial/lib/labels';
import type { OrdersSearchParams } from '../lib/orders-filter';
import { warehouseItemOptionsQueryOptions, warehouseOptionsQueryOptions } from '../queries';

export interface OrdersFiltersProps {
  search: OrdersSearchParams;
  onChange: (patch: Partial<OrdersSearchParams>) => void;
  /** Baris yang sudah dimuat: sumber nama customer bagi pengguna yang hanya boleh melihat (tanpa `options`). */
  rows: readonly WarehouseDispatchListItemDto[];
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Semua status' },
  { value: 'pending', label: 'Belum selesai' },
  { value: 'done', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan otomatis' },
];
const KIND_OPTIONS = [
  { value: 'all', label: 'Semua jenis' },
  { value: 'order', label: WAREHOUSE_KIND_LABEL.order },
  { value: 'ready', label: WAREHOUSE_KIND_LABEL.ready },
];

interface DateRange {
  from: string | undefined;
  to: string | undefined;
}

/** Dua kolom tanggal keluar; di dalam chip ditahan sebagai SATU draf dan diterapkan sekali saat chip menutup. */
function DateRangeFields({
  from,
  to,
  onCommit,
}: {
  from: string | undefined;
  to: string | undefined;
  onCommit: (range: DateRange) => void;
}) {
  const [range, setRange] = useChipDraft<DateRange>(
    { from: from || undefined, to: to || undefined },
    onCommit,
  );
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="wh-orders-from" className="text-xs text-muted-foreground">
          Tanggal dari
        </Label>
        <Input
          id="wh-orders-from"
          type="date"
          value={range.from ?? ''}
          onChange={(event) => setRange({ ...range, from: event.target.value || undefined })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wh-orders-to" className="text-xs text-muted-foreground">
          Tanggal sampai
        </Label>
        <Input
          id="wh-orders-to"
          type="date"
          value={range.to ?? ''}
          onChange={(event) => setRange({ ...range, to: event.target.value || undefined })}
        />
      </div>
    </div>
  );
}

function rangeDisplay(from: string | undefined, to: string | undefined): string | null {
  if (from && to) return `${formatDay(from)} - ${formatDay(to)}`;
  if (from) return `Sejak ${formatDay(from)}`;
  if (to) return `Sampai ${formatDay(to)}`;
  return null;
}

/**
 * Filter Riwayat Gudang: kolom cari, Jenis, Customer, BU, Tanggal, dan Status. Customer dan BU jamak (maks.
 * `FILTER_LIST_MAX`). Pilihan customer dari `serialWarehouse.options` hanya bagi pengguna `serialwh: edit` (rute itu
 * butuh edit), selain itu dari baris yang sudah dimuat.
 */
export function OrdersFilters({ search, onChange, rows }: OrdersFiltersProps) {
  const statusOptions = STATUS_OPTIONS;
  const me = useMe();
  const canOptions = canUseWarehouse(me);
  const options = useQuery({ ...warehouseOptionsQueryOptions(), enabled: canOptions });
  // Tipe (Item): pilihan dicari di server bagi pengguna `edit`; selain itu dari baris yang sudah dimuat.
  const [itemTerm, setItemTerm] = useState('');
  const itemQuery = useInfiniteQuery({
    ...warehouseItemOptionsQueryOptions(itemTerm.trim() !== '' ? { query: itemTerm.trim() } : {}),
    enabled: canOptions,
  });
  const itemMap = new Map<string, string>();
  for (const page of itemQuery.data?.pages ?? []) {
    for (const item of page.items) itemMap.set(item.id, item.label);
  }
  for (const row of rows) if (row.itemId !== '') itemMap.set(row.itemId, row.itemLabel);
  const itemOptions: LinkOption[] = [...itemMap.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
  const itemLabel = (id: string) => itemMap.get(id) ?? 'Tipe terpilih';
  const itemIds = search.itemIds ?? [];
  const readableBu = new Set(buIdsWithLevelOf(me, 'serialwh', 'view'));
  const buOptions: LinkOption[] = (me.businessUnits ?? [])
    .filter((bu) => !bu.deleted && readableBu.has(bu.id))
    .map((bu) => ({ id: bu.id, label: formatBuLabel(bu) }));
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';

  const customerMap = new Map<string, string>();
  for (const customer of options.data?.customers ?? []) customerMap.set(customer.id, customer.name);
  for (const row of rows) {
    if (row.customerId !== '' && row.customerName !== '') {
      customerMap.set(row.customerId, row.customerName);
    }
  }
  const customerOptions: LinkOption[] = [...customerMap.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
  const customerLabel = (id: string) => customerMap.get(id) ?? 'Customer terpilih';

  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) =>
    onChange({ q: value.trim() === '' ? undefined : value.trim() }),
  );
  const customerIds = search.customerIds ?? [];
  const buIds = search.buIds ?? [];
  const status = search.status ?? 'all';

  return (
    <FilterBar
      search={{
        value: text,
        onChange: setText,
        placeholder: 'Cari No Riwayat, No SO, atau customer',
        label: 'Cari No Riwayat, No SO, atau customer',
      }}
    >
      <FilterChip
        label="Jenis"
        display={search.kind ? WAREHOUSE_KIND_LABEL[search.kind] : null}
        onClear={() => onChange({ kind: undefined })}
      >
        <Select
          id="wh-orders-kind"
          label="Filter jenis"
          hideLabel
          options={KIND_OPTIONS}
          value={search.kind ?? 'all'}
          onValueChange={(next) =>
            onChange({ kind: next === 'order' || next === 'ready' ? next : undefined })
          }
        />
      </FilterChip>
      {
        <FilterChip
          label="Customer"
          display={multiFilterDisplay(customerIds.map(customerLabel))}
          onClear={() => onChange({ customerIds: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="wh-orders-customer"
            label="Filter customer"
            hideLabel
            placeholder="Semua customer"
            localFilter
            highlight
            value={customerIds}
            labelOf={customerLabel}
            options={customerOptions}
            onChange={(next) => onChange({ customerIds: next.length > 0 ? next : undefined })}
          />
        </FilterChip>
      }
      <FilterChip
        label="Tipe"
        display={multiFilterDisplay(itemIds.map(itemLabel))}
        onClear={() => onChange({ itemIds: undefined })}
      >
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="wh-orders-item"
          label="Filter Tipe"
          hideLabel
          placeholder="Semua Tipe"
          highlight
          value={itemIds}
          labelOf={itemLabel}
          options={itemOptions}
          loading={itemQuery.isFetching && itemQuery.data === undefined}
          hasMore={itemQuery.hasNextPage}
          onSearchChange={setItemTerm}
          searchDebounceMs={200}
          onChange={(next) => onChange({ itemIds: next.length > 0 ? next : undefined })}
        />
      </FilterChip>
      <FilterChip
        label="BU"
        display={multiFilterDisplay(buIds.map(buLabel))}
        onClear={() => onChange({ buIds: undefined })}
      >
        <LinkMultiField
          maxSelected={FILTER_LIST_MAX}
          id="wh-orders-bu"
          label="Filter BU"
          hideLabel
          placeholder="Semua BU"
          localFilter
          highlight
          value={buIds}
          labelOf={buLabel}
          options={buOptions}
          onChange={(next) => onChange({ buIds: next.length > 0 ? next : undefined })}
        />
      </FilterChip>
      <FilterChip
        label="Tanggal"
        display={rangeDisplay(search.from, search.to)}
        onClear={() => onChange({ from: undefined, to: undefined })}
      >
        <DateRangeFields
          from={search.from}
          to={search.to}
          onCommit={(range) => onChange({ from: range.from, to: range.to })}
        />
      </FilterChip>
      <FilterChip
        label="Status"
        display={
          status === 'all' ? null : (statusOptions.find((o) => o.value === status)?.label ?? null)
        }
        onClear={() => onChange({ status: undefined })}
      >
        <Select
          id="wh-orders-status"
          label="Filter status"
          hideLabel
          options={statusOptions}
          value={status}
          onValueChange={(next) =>
            onChange({
              status: next === 'all' ? undefined : (next as 'pending' | 'done' | 'cancelled'),
            })
          }
        />
      </FilterChip>
    </FilterBar>
  );
}
