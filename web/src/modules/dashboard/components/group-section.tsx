import {
  type DashboardGroupId,
  type DashboardOptionKind,
  GROUP_FILTERS,
  GROUP_LABELS,
  type GroupFilterField,
  type WidgetMeta,
  type WidgetResult,
} from '@shared/dashboard';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { MultiSelect } from '@/components/select';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { useTrackNearViewport } from '@/lib/near-viewport';
import { type DashboardSearch, groupFilterParam, toQueryInput } from '../lib/search';
import { dashboardOptionsQueryOptions, dashboardQueryOptions } from '../queries';
import { WidgetCard, type WidgetFilterState } from './widgets/widget-card';

const RELATION_KEY: Record<NonNullable<GroupFilterField['relation']>, DashboardOptionKind> = {
  customer: 'customers',
  item: 'items',
  stickerType: 'stickerTypes',
  sticker: 'stickers',
};

/**
 * Pilihan relasi dengan pencarian di server (keputusan pemilik 2026-11-23): kata ketik dikirim ke `dashboard.options`
 * lewat `onSearchChange`, yang di-debounce `ComboboxBase` (`useSearchTerm`, bawaan 200 ms; tak dipanggil saat mount),
 * halaman pertama saja; `next` menyalakan petunjuk "persempit pencarian". Dipasang di dalam isi chip, jadi hanya
 * meminta saat chip terbuka. Setiap halaman hasil dicatat ke `remember` agar nama opsi yang baru dipilih langsung
 * dikenal (chip draf di input dan tombol chip), tanpa menunggu resolusi `ids`.
 */
function RelationPicker({
  kind,
  field,
  value,
  labelOf,
  onChange,
  remember,
  id,
}: {
  kind: DashboardOptionKind;
  field: GroupFilterField;
  value: string[];
  labelOf: (item: string) => string;
  onChange: (next: string[]) => void;
  remember: Map<string, string>;
  id: string;
}) {
  const [term, setTerm] = useState('');
  const page = useQuery({
    ...dashboardOptionsQueryOptions({ kind, ...(term === '' ? {} : { query: term }) }),
    placeholderData: keepPreviousData,
  });
  const source: LinkOption[] = (page.data?.[kind] ?? []).map((option) => ({
    id: option.value,
    label: option.label,
  }));
  // Ditulis saat render (monoton dan idempoten) agar chip draf di input yang dirender setelah ini sudah mengenalnya.
  for (const option of source) remember.set(option.id, option.label);
  return (
    <LinkMultiField
      maxSelected={FILTER_LIST_MAX}
      id={id}
      label={`Filter ${field.label}`}
      hideLabel
      placeholder={`Semua ${field.label.toLowerCase()}`}
      highlight
      value={value}
      labelOf={labelOf}
      options={source}
      loading={page.isFetching}
      hasMore={page.data?.next?.[kind] !== undefined}
      onSearchChange={setTerm}
      onChange={onChange}
    />
  );
}

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
  const kind = RELATION_KEY[field.relation ?? 'customer'];
  const resolved = useQuery({
    ...dashboardOptionsQueryOptions({ kind, ids: value }),
    enabled: value.length > 0,
    placeholderData: keepPreviousData,
  });
  // Peta id -> nama yang diingat selama chip hidup: dari halaman hasil pencarian dan dari resolusi `ids`.
  const remembered = useRef(new Map<string, string>());
  for (const option of resolved.data?.[kind] ?? [])
    remembered.current.set(option.value, option.label);
  // "Tidak dikenal" hanya bila respons `ids` yang final (bukan placeholder, bukan sedang dimuat) tak memuat id itu.
  const settled = resolved.isSuccess && !resolved.isPlaceholderData && !resolved.isFetching;
  const labelOf = (item: string) =>
    remembered.current.get(item) ?? (settled ? `${field.label} tidak dikenal` : 'Memuat…');
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
        remember={remembered.current}
        id={id}
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
  // Hanya grup yang berada di dekat viewport yang diminta dan disegarkan; yang di luar layar menunggu (data lama tetap).
  const [sectionRef, near] = useTrackNearViewport();
  const query = useQuery({ ...dashboardQueryOptions(input), enabled: near });
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
    <section ref={sectionRef} aria-labelledby={`dashboard-group-${group}`} className="space-y-3">
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
