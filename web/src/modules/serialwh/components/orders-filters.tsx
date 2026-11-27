import { formatBuLabel } from '@shared/business-units';
import type { WarehouseOrderSummaryDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
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
import { warehouseOptionsQueryOptions } from '../queries';

export interface OrdersFiltersProps {
  search: OrdersSearchParams;
  onChange: (patch: Partial<OrdersSearchParams>) => void;
  /** Baris yang sudah dimuat: sumber nama customer bagi pengguna yang hanya boleh melihat (tanpa `options`). */
  rows: readonly WarehouseOrderSummaryDto[];
  /** `ready` = tab Ready: tanpa kolom cari dan Customer, status memuat "Dibatalkan otomatis". */
  mode?: 'order' | 'ready';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Semua status' },
  { value: 'pending', label: 'Belum selesai' },
  { value: 'done', label: 'Selesai' },
];
const READY_STATUS_OPTIONS = [
  ...STATUS_OPTIONS,
  { value: 'cancelled', label: 'Dibatalkan otomatis' },
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
          Tanggal keluar dari
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
          Tanggal keluar sampai
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
 * Filter Riwayat Gudang: kolom cari, Customer, BU, Tanggal keluar, dan Status. Customer dan BU jamak (maks.
 * `FILTER_LIST_MAX`). Pilihan customer dari `serialWarehouse.options` hanya bagi pengguna `serialwh: edit` (rute itu
 * butuh edit), selain itu dari baris yang sudah dimuat.
 */
export function OrdersFilters({ search, onChange, rows, mode = 'order' }: OrdersFiltersProps) {
  const isReady = mode === 'ready';
  const statusOptions = isReady ? READY_STATUS_OPTIONS : STATUS_OPTIONS;
  const me = useMe();
  const canOptions = canUseWarehouse(me);
  const options = useQuery({ ...warehouseOptionsQueryOptions(), enabled: canOptions });
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
      {...(isReady
        ? {}
        : {
            search: {
              value: text,
              onChange: setText,
              placeholder: 'Cari No SO',
              label: 'Cari No SO',
            },
          })}
    >
      {isReady ? null : (
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
      )}
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
        label="Tanggal keluar"
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
