import {
  DASHBOARD_GROUPS,
  type DashboardGroupId,
  type DashboardRange,
  GROUP_FILTERS,
  type GroupFilterField,
  validateDashboardRange,
} from '@shared/dashboard';
import type {
  PublicDashboardDto,
  PublicFilterOption,
  PublicQueryInput,
} from '@shared/dashboard-public';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { MultiSelect } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { formatRangeLabel } from '../dashboard/lib/format';
import { type DashboardSearch, groupFilterParam, groupFilters } from '../dashboard/lib/search';

const asLink = (options: readonly PublicFilterOption[]): LinkOption[] =>
  options.map((option) => ({ id: option.value, label: option.label }));

/**
 * Filter penonton dari search param halaman: BU, lokasi, rentang (hanya bila `from` dan `to` ada dan sah), dan filter
 * grup. Server hanya mempersempit (menjepit dan mengiris ke cakupan beku), jadi nilai di luar pilihan tidak membuka
 * data tambahan. Param kosong tidak dikirim, sehingga tampilan bawaan pembagi memakai GET.
 */
export function viewerFromSearch(search: DashboardSearch): PublicQueryInput {
  const viewer: PublicQueryInput = {};
  if (search.bu && search.bu.length > 0) viewer.buIds = search.bu;
  if (search.loc && search.loc.length > 0) viewer.locationIds = search.loc;
  if (search.from && search.to) {
    const range = { from: search.from, to: search.to };
    if (validateDashboardRange(range) === null) {
      viewer.from = range.from;
      viewer.to = range.to;
    }
  }
  const groups: NonNullable<PublicQueryInput['groups']> = {};
  for (const group of DASHBOARD_GROUPS) {
    const filters = groupFilters(search, group);
    if (Object.keys(filters).length > 0) groups[group] = filters;
  }
  if (Object.keys(groups).length > 0) viewer.groups = groups;
  return viewer;
}

/** Isi chip Tanggal: dua kolom tanggal dijepit ke rentang pembagi, diterapkan sekali saat chip menutup. */
function PublicDateFilter({
  range,
  bounds,
  onCommit,
}: {
  range: DashboardRange;
  bounds: DashboardRange;
  onCommit: (range: DashboardRange) => void;
}) {
  const [draft, setDraft] = useChipDraft<DashboardRange>(range, (next) => {
    if (validateDashboardRange(next) === null) onCommit(next);
  });
  const problem = draft.from && draft.to ? validateDashboardRange(draft) : null;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="public-filter-from" className="text-xs text-muted-foreground">
          Dari tanggal
        </Label>
        <Input
          id="public-filter-from"
          type="date"
          value={draft.from}
          min={bounds.from}
          max={bounds.to}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="public-filter-to" className="text-xs text-muted-foreground">
          Sampai tanggal
        </Label>
        <Input
          id="public-filter-to"
          type="date"
          value={draft.to}
          min={bounds.from}
          max={bounds.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Hanya dalam {formatRangeLabel(bounds)}; di luar itu dipotong otomatis.
      </p>
      {problem ? (
        <p role="alert" className="text-xs text-destructive-text">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Filter global halaman publik: hanya BU/Lokasi yang ditawarkan `options` dan Tanggal. */
export function PublicGlobalFilters({
  dto,
  search,
  onChange,
}: {
  /** `dto.bounds` = rentang beku pembagi, batas kolom tanggal (juga saat halaman dibuka dari URL berfilter). */
  dto: PublicDashboardDto;
  search: DashboardSearch;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const buOptions = asLink(dto.options.bu);
  const locationOptions = asLink(dto.options.location);
  const buIds = search.bu ?? [];
  const locationIds = search.loc ?? [];
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const locationLabel = (id: string) =>
    locationOptions.find((option) => option.id === id)?.label ?? 'Lokasi tidak dikenal';
  const explicitDate = Boolean(search.from && search.to);
  return (
    <FilterBar>
      {buOptions.length > 0 ? (
        <FilterChip
          label="BU"
          display={multiFilterDisplay(buIds.map(buLabel))}
          onClear={() => onChange({ bu: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="public-filter-bu"
            label="Filter BU"
            hideLabel
            placeholder="Semua BU"
            localFilter
            highlight
            value={buIds}
            labelOf={buLabel}
            options={buOptions}
            onChange={(next) => onChange({ bu: next.length > 0 ? next : undefined })}
          />
        </FilterChip>
      ) : null}
      {locationOptions.length > 0 ? (
        <FilterChip
          label="Lokasi"
          display={multiFilterDisplay(locationIds.map(locationLabel))}
          onClear={() => onChange({ loc: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="public-filter-location"
            label="Filter lokasi"
            hideLabel
            placeholder="Semua lokasi"
            localFilter
            highlight
            value={locationIds}
            labelOf={locationLabel}
            options={locationOptions}
            onChange={(next) => onChange({ loc: next.length > 0 ? next : undefined })}
          />
        </FilterChip>
      ) : null}
      <FilterChip
        label="Tanggal"
        display={formatRangeLabel(dto.range)}
        {...(explicitDate ? { onClear: () => onChange({ from: undefined, to: undefined }) } : {})}
      >
        <PublicDateFilter
          range={dto.range}
          bounds={dto.bounds}
          onCommit={(next) => onChange({ from: next.from, to: next.to })}
        />
      </FilterChip>
    </FilterBar>
  );
}

function PublicGroupChip({
  group,
  field,
  offered,
  search,
  onChange,
}: {
  group: DashboardGroupId;
  field: GroupFilterField;
  /** Pilihan relasi yang ditawarkan pembagi (hanya untuk `kind: 'relation'`). */
  offered: readonly PublicFilterOption[] | undefined;
  search: DashboardSearch;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const param = groupFilterParam(group, field.key);
  const raw = search[param];
  const value = Array.isArray(raw) ? raw : [];
  const set = (next: string[]) => onChange({ [param]: next.length > 0 ? next : undefined });
  const id = `public-filter-${param}`;
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
  if (!offered) return null;
  const options = asLink(offered);
  const labelOf = (item: string) =>
    options.find((option) => option.id === item)?.label ?? `${field.label} tidak dikenal`;
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
        options={options}
        onChange={set}
      />
    </FilterChip>
  );
}

/**
 * Chip filter satu grup: filter enum grup selalu tersedia, filter relasi HANYA bila pembagi menawarkannya
 * (`options.groups[kunci]`). Tanpa chip yang berlaku, tidak merender apa pun.
 */
export function PublicGroupFilters({
  group,
  dto,
  search,
  onChange,
}: {
  group: DashboardGroupId;
  dto: PublicDashboardDto;
  search: DashboardSearch;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const fields = GROUP_FILTERS[group].filter(
    (field) => field.kind === 'enum' || dto.options.groups[field.key] !== undefined,
  );
  if (fields.length === 0) return null;
  return (
    <FilterBar>
      {fields.map((field) => (
        <PublicGroupChip
          key={field.key}
          group={group}
          field={field}
          offered={dto.options.groups[field.key]}
          search={search}
          onChange={onChange}
        />
      ))}
    </FilterBar>
  );
}
