import {
  type DashboardGroupId,
  GROUP_FILTERS,
  GROUP_LABELS,
  type GroupFilterField,
  type WidgetMeta,
  type WidgetResult,
} from '@shared/dashboard';
import { useQuery } from '@tanstack/react-query';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { MultiSelect } from '@/components/select';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { useMe } from '@/modules/auth/use-me';
import { cellClass, ROW_CLASS, rowsOf } from '../lib/layout';
import { widgetLinks } from '../lib/links';
import { type DashboardSearch, groupFilterParam, toQueryInput } from '../lib/search';
import { dashboardQueryOptions } from '../queries';
import { RelationPicker, useRelationLabels } from './relation-field';
import { WidgetCard, type WidgetFilterState } from './widgets/widget-card';

function GroupFilterChip({
  group,
  field,
  search,
  onChange,
}: {
  group: DashboardGroupId;
  field: GroupFilterField;
  search: DashboardSearch;
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
  return <RelationChip field={field} value={value} id={id} set={set} />;
}

/** Chip filter relasi: nama nilai terpilih (dari URL atau pilihan) diresolusi server lewat `ids`. */
function RelationChip({
  field,
  value,
  id,
  set,
}: {
  field: GroupFilterField;
  value: string[];
  id: string;
  set: (next: string[]) => void;
}) {
  const { kind, labelOf, remember } = useRelationLabels(field, value);
  return (
    <FilterChip
      label={field.label}
      display={multiFilterDisplay(value.map(labelOf))}
      onClear={() => set([])}
    >
      <RelationPicker
        kind={kind}
        field={field}
        value={value}
        labelOf={labelOf}
        onChange={set}
        remember={remember}
        id={id}
      />
    </FilterChip>
  );
}

/**
 * Isi satu tab grup: chip filter grup, lalu baris-baris kartu (`rowsOf`: number card paling atas, lalu grafik, lalu
 * daftar; jenis berbeda tak dicampur satu baris). Tiap grup punya query sendiri (kunci berisi input grup itu saja) dan
 * hanya tab yang aktif yang terpasang, jadi hanya grup itu yang diminta. Satu widget gagal tidak menyembunyikan yang
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
  const me = useMe();
  const input = toQueryInput(
    search,
    today,
    widgets.map((meta) => meta.id),
  );
  const query = useQuery(dashboardQueryOptions(input));
  const fields = GROUP_FILTERS[group];
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
    <section aria-label={GROUP_LABELS[group]} className="space-y-3">
      {fields.length > 0 ? (
        <FilterBar>
          {fields.map((field) => (
            <GroupFilterChip
              key={field.key}
              group={group}
              field={field}
              search={search}
              onChange={onChange}
            />
          ))}
        </FilterBar>
      ) : null}
      {rowsOf(widgets).map((row) => (
        <div key={row[0]?.id} data-row={row[0]?.row} className={ROW_CLASS}>
          {row.map((meta) => (
            <div key={meta.id} className={`min-w-0 ${cellClass(meta)}`}>
              <WidgetCard
                meta={meta}
                result={resultOf(meta)}
                loading={query.isPending}
                filterState={filterState}
                links={widgetLinks(me, meta.id)}
                onRetry={() => void query.refetch()}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
