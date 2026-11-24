import type { MeDto } from '@shared/contract';
import {
  type DashboardRange,
  type RangePreset,
  rangePreset,
  validateDashboardRange,
} from '@shared/dashboard';
import { hasLevel } from '@shared/permissions';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { buIdsWithLevelOf, can } from '@/modules/auth/permissions';
import { formatRangeLabel } from '../lib/format';
import type { DashboardSearch } from '../lib/search';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'last7', label: '7 hari terakhir' },
  { id: 'last30', label: '30 hari terakhir' },
  { id: 'thisMonth', label: 'Bulan ini' },
  { id: 'lastMonth', label: 'Bulan lalu' },
];

/** BU yang boleh dipilih di filter: BU hidup tempat pengguna membaca serial atau servis (widget ber-BU). */
export function buFilterOptions(me: MeDto): LinkOption[] {
  const readable = new Set([
    ...buIdsWithLevelOf(me, 'serial', 'view'),
    ...buIdsWithLevelOf(me, 'serialservice', 'view'),
  ]);
  return (me.businessUnits ?? [])
    .filter((bu) => !bu.deleted && readable.has(bu.id))
    .map((bu) => ({ id: bu.id, label: `${bu.code} · ${bu.name}` }));
}

/** Lokasi yang boleh dipilih: lokasi tempat pengguna membaca Serah Terima, QC, atau stok (atau semua bila pemegang Serial). */
export function locationFilterOptions(me: MeDto): LinkOption[] {
  const serialReader =
    can(me, 'serial', 'view') ||
    buIdsWithLevelOf(me, 'serial', 'view').length > 0 ||
    buIdsWithLevelOf(me, 'serialservice', 'view').length > 0;
  return me.locations
    .filter(
      (location) =>
        serialReader ||
        hasLevel(location.permissions.handover, 'view') ||
        hasLevel(location.permissions.qc, 'edit') ||
        hasLevel(location.permissions.stickerstock, 'view'),
    )
    .map((location) => ({
      id: location.id,
      label: `${location.code} · ${location.name}`,
    }));
}

function presetLabel(range: DashboardRange, today: string): string | null {
  for (const preset of PRESETS) {
    const candidate = rangePreset(preset.id, today);
    if (candidate.from === range.from && candidate.to === range.to) return preset.label;
  }
  return null;
}

/** Isi chip Tanggal: preset dan rentang kustom ditahan sebagai SATU draf, diterapkan sekali saat chip menutup. */
function DateFilter({
  range,
  today,
  onCommit,
}: {
  range: DashboardRange;
  today: string;
  onCommit: (range: DashboardRange) => void;
}) {
  const [draft, setDraft] = useChipDraft<DashboardRange>(range, (next) => {
    if (validateDashboardRange(next) === null) onCommit(next);
  });
  const problem = draft.from && draft.to ? validateDashboardRange(draft) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant="outline"
            color="primary"
            onClick={() => setDraft(rangePreset(preset.id, today))}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dashboard-filter-from" className="text-xs text-muted-foreground">
          Dari tanggal
        </Label>
        <Input
          id="dashboard-filter-from"
          type="date"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dashboard-filter-to" className="text-xs text-muted-foreground">
          Sampai tanggal
        </Label>
        <Input
          id="dashboard-filter-to"
          type="date"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-destructive-text">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Filter global dashboard: BU, Lokasi, dan Tanggal (maks. 366 hari; rentang tak sah tak diterapkan). */
export function GlobalFilters({
  me,
  search,
  today,
  range,
  showBu,
  showLocation,
  onChange,
}: {
  me: MeDto;
  search: DashboardSearch;
  today: string;
  range: DashboardRange;
  showBu: boolean;
  showLocation: boolean;
  onChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const buOptions = buFilterOptions(me);
  const locationOptions = locationFilterOptions(me);
  const buIds = search.bu ?? [];
  const locationIds = search.loc ?? [];
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const locationLabel = (id: string) =>
    locationOptions.find((option) => option.id === id)?.label ?? 'Lokasi tidak dikenal';
  const explicitDate = Boolean(search.from && search.to);
  return (
    <FilterBar>
      {showBu ? (
        <FilterChip
          label="BU"
          display={multiFilterDisplay(buIds.map(buLabel))}
          onClear={() => onChange({ bu: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="dashboard-filter-bu"
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
      {showLocation ? (
        <FilterChip
          label="Lokasi"
          display={multiFilterDisplay(locationIds.map(locationLabel))}
          onClear={() => onChange({ loc: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="dashboard-filter-location"
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
        display={presetLabel(range, today) ?? formatRangeLabel(range)}
        {...(explicitDate ? { onClear: () => onChange({ from: undefined, to: undefined }) } : {})}
      >
        <DateFilter
          range={range}
          today={today}
          onCommit={(next) => onChange({ from: next.from, to: next.to })}
        />
      </FilterChip>
    </FilterBar>
  );
}
