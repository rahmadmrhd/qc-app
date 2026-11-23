import {
  type DashboardGroupId,
  type DashboardOptionsDto,
  GROUP_FILTERS,
  GROUP_LABELS,
  type GroupFilterField,
  type WidgetMeta,
  type WidgetResult,
} from '@shared/dashboard';
import { useQuery } from '@tanstack/react-query';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { MultiSelect } from '@/components/select';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { type DashboardSearch, groupFilterParam, toQueryInput } from '../lib/search';
import { dashboardOptionsQueryOptions, dashboardQueryOptions } from '../queries';
import { WidgetCard, type WidgetFilterState } from './widgets/widget-card';

const RELATION_KEY: Record<NonNullable<GroupFilterField['relation']>, keyof DashboardOptionsDto> = {
  customer: 'customers',
  item: 'items',
  stickerType: 'stickerTypes',
  sticker: 'stickers',
};

/** Lebar kartu di kisi 12 kolom (>= 768 px): angka kecil berderet, grafik 6 kolom, tren dan daftar 12 kolom; ponsel kisi 2 kolom (angka 1 kolom, lainnya selebar 2). */
function spanClass(meta: WidgetMeta): string {
  switch (meta.visual) {
    case 'number':
      return 'md:col-span-4 xl:col-span-3';
    case 'donut':
    case 'pie':
    case 'bar':
    case 'barH':
      return 'col-span-2 md:col-span-6';
    default:
      return 'col-span-2 md:col-span-12';
  }
}

function GroupFilterChip({
  group,
  field,
  search,
  options,
  onChange,
}: {
  group: DashboardGroupId;
  field: GroupFilterField;
  search: DashboardSearch;
  options: DashboardOptionsDto | undefined;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const param = groupFilterParam(group, field.key);
  const raw = search[param];
  const value = Array.isArray(raw) ? raw : [];
  const set = (next: string[]) => onChange({ [param]: next.length > 0 ? next : undefined });
  const id = `dashboard-filter-${param}`;
  if (field.kind === 'enum') {
    const choices = field.options ?? [];
    const labelOf = (item: string) =>
      choices.find((option) => option.value === item)?.label ?? item;
    return (
      <FilterChip
        label={field.label}
        display={multiFilterDisplay(value.map(labelOf))}
        onClear={() => set([])}
      >
        <MultiSelect
          maxSelected={FILTER_LIST_MAX}
          id={id}
          label={`Filter ${field.label}`}
          hideLabel
          placeholder={`Semua ${field.label.toLowerCase()}`}
          options={[...choices]}
          value={value}
          onValueChange={set}
        />
      </FilterChip>
    );
  }
  const source: LinkOption[] =
    field.relation && options
      ? options[RELATION_KEY[field.relation]].map((option) => ({
          id: option.value,
          label: option.label,
        }))
      : [];
  const labelOf = (item: string) =>
    source.find((option) => option.id === item)?.label ?? `${field.label} tidak dikenal`;
  return (
    <FilterChip
      label={field.label}
      display={multiFilterDisplay(value.map(labelOf))}
      onClear={() => set([])}
    >
      <LinkMultiField
        maxSelected={FILTER_LIST_MAX}
        id={id}
        label={`Filter ${field.label}`}
        hideLabel
        placeholder={`Semua ${field.label.toLowerCase()}`}
        localFilter
        highlight
        value={value}
        labelOf={labelOf}
        options={source}
        onChange={set}
      />
    </FilterChip>
  );
}

/**
 * Satu grup widget: judul, chip filter grup, dan kisi kartu. Tiap grup punya query sendiri (kunci berisi input grup
 * itu saja), jadi mengubah filter satu grup tidak memuat ulang grup lain. Satu widget gagal tidak menyembunyikan yang
 * lain; "Coba lagi" memuat ulang permintaan grup.
 */
export function GroupSection({
  group,
  widgets,
  search,
  today,
  filterState,
  onChange,
}: {
  group: DashboardGroupId;
  widgets: readonly WidgetMeta[];
  search: DashboardSearch;
  today: string;
  filterState: WidgetFilterState;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const input = toQueryInput(
    search,
    today,
    widgets.map((meta) => meta.id),
  );
  const query = useQuery(dashboardQueryOptions(input));
  const fields = GROUP_FILTERS[group];
  const needsOptions = fields.some((field) => field.kind === 'relation');
  const optionsQuery = useQuery({ ...dashboardOptionsQueryOptions(), enabled: needsOptions });
  const results = new Map(query.data?.widgets.map((result) => [result.id, result]));
  const resultOf = (meta: WidgetMeta): WidgetResult | undefined => {
    if (query.isError) {
      return { id: meta.id, status: 'error', message: 'Dashboard tidak dapat dimuat' };
    }
    if (!query.isSuccess) return undefined;
    return (
      results.get(meta.id) ?? { id: meta.id, status: 'error', message: 'Widget tidak tersedia' }
    );
  };
  return (
    <section aria-labelledby={`dashboard-group-${group}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`dashboard-group-${group}`} className="text-lg font-semibold">
          {GROUP_LABELS[group]}
        </h2>
        {fields.length > 0 ? (
          <FilterBar>
            {fields.map((field) => (
              <GroupFilterChip
                key={field.key}
                group={group}
                field={field}
                search={search}
                options={optionsQuery.data}
                onChange={onChange}
              />
            ))}
          </FilterBar>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
        {widgets.map((meta) => (
          <div key={meta.id} className={`min-w-0 ${spanClass(meta)}`}>
            <WidgetCard
              meta={meta}
              result={resultOf(meta)}
              loading={query.isPending}
              filterState={filterState}
              onRetry={() => void query.refetch()}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
