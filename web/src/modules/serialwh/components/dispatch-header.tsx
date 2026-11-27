import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDay } from '@/modules/serial/lib/labels';
import { todayWib } from '@/modules/serial/lib/locations';
import type { MissingField } from '../lib/draft';
import type { WarehouseDraft } from '../lib/draft-store';

export type DispatchFilters = WarehouseDraft['filters'];

export interface DispatchHeaderProps {
  itemId: string;
  itemOptions: readonly LinkOption[];
  itemLoading: boolean;
  hasMoreItems: boolean;
  onItemSearch: (term: string) => void;
  onItemChange: (id: string | null) => void;
  itemLabelOf: (id: string) => string | undefined;
  /** Jumlah serial terpilih; > 0 mengunci Item. */
  selectedCount: number;
  onClearSelection: () => void;
  filters: DispatchFilters;
  onFiltersChange: (patch: Partial<DispatchFilters>) => void;
  buOptions: readonly LinkOption[];
  locationOptions: readonly LinkOption[];
  /** Seluruh form dikunci (pengeluaran sedang dikirim). */
  frozen?: boolean;
  /** Slot di bawah field Item (banner "terisi dari catatan task", chip saran). */
  itemExtra?: ReactNode;
  /** Slot di sebelah field Item pada desktop (kolom Serial Number). */
  scan: ReactNode;
  /**
   * Ponsel: kolom scan dirender sebagai anak LANGSUNG form (bukan sel grid) agar `sticky`-nya mengikuti tinggi seluruh
   * form dan benar-benar menempel di atas layar saat daftar digulir.
   */
  phone?: boolean;
  /** Isian wajib yang membuat scan terakhir ditahan: chip/field-nya diberi bingkai merah. */
  missing?: readonly MissingField[];
}

/**
 * Bagian atas form (spek 5.3): field wajib Item (terkunci bila ada pilihan) sebaris dengan kolom Serial Number di
 * desktop; chip filter BU/Lokasi/Tanggal uji dan saklar di bawahnya. Di ponsel Item di atas, kolom scan di bawahnya.
 */
export function DispatchHeader({
  itemId,
  itemOptions,
  itemLoading,
  hasMoreItems,
  onItemSearch,
  onItemChange,
  itemLabelOf,
  selectedCount,
  onClearSelection,
  filters,
  onFiltersChange,
  buOptions,
  locationOptions,
  frozen = false,
  itemExtra,
  scan,
  phone = false,
  missing = [],
}: DispatchHeaderProps) {
  const locked = selectedCount > 0 || frozen;
  const labelIn = (options: readonly LinkOption[], id: string, fallback: string) =>
    options.find((option) => option.id === id)?.label ?? fallback;
  const itemBlock = (
    <div className="space-y-1.5">
      <LinkField
        id="wh-item"
        label="Item"
        required
        value={itemId === '' ? null : itemId}
        onChange={onItemChange}
        labelOf={itemLabelOf}
        options={itemOptions}
        loading={itemLoading}
        hasMore={hasMoreItems}
        onSearchChange={onItemSearch}
        searchDebounceMs={200}
        disabled={locked}
        placeholder="Pilih Item (merk dan tipe)"
        {...(missing.includes('item') && itemId === '' ? { error: 'Pilih Item dulu' } : {})}
      />
      {locked && selectedCount > 0 ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3" />
          <span>
            Terkunci karena {selectedCount} serial sudah dipilih. Selesaikan pengeluaran Tipe ini,
            atau
          </span>
          {frozen ? null : (
            <Button
              type="button"
              variant="link"
              color="primary"
              className="h-auto p-0 text-xs"
              onClick={onClearSelection}
            >
              Batalkan pilihan
            </Button>
          )}
          <span>.</span>
        </p>
      ) : null}
      {itemExtra}
    </div>
  );
  const rest = (
    <>
      <FilterBar>
        <FilterChip
          label="BU"
          display={
            filters.buId === '' ? null : labelIn(buOptions, filters.buId, 'BU tidak dikenal')
          }
          onClear={() => onFiltersChange({ buId: '' })}
          invalid={missing.includes('bu') && filters.buId === ''}
        >
          <LinkField
            id="wh-filter-bu"
            label="Filter BU"
            hideLabel
            keyboardless
            localFilter
            highlight
            placeholder="Semua BU"
            value={filters.buId === '' ? null : filters.buId}
            options={buOptions}
            disabled={frozen}
            onChange={(next) => onFiltersChange({ buId: next ?? '' })}
          />
        </FilterChip>
        <FilterChip
          label="Lokasi"
          display={
            filters.locationId === ''
              ? null
              : labelIn(locationOptions, filters.locationId, 'Lokasi tidak dikenal')
          }
          onClear={() => onFiltersChange({ locationId: '' })}
          invalid={missing.includes('location') && filters.locationId === ''}
        >
          <LinkField
            id="wh-filter-location"
            label="Filter lokasi"
            hideLabel
            localFilter
            highlight
            placeholder="Semua lokasi"
            value={filters.locationId === '' ? null : filters.locationId}
            options={locationOptions}
            disabled={frozen}
            onChange={(next) => onFiltersChange({ locationId: next ?? '' })}
          />
        </FilterChip>
        <FilterChip
          label="Tanggal uji"
          display={filters.testDate === '' ? null : formatDay(filters.testDate)}
          onClear={() => onFiltersChange({ testDate: '' })}
          invalid={missing.includes('testDate') && filters.testDate === ''}
        >
          <TestDateField
            value={filters.testDate}
            disabled={frozen}
            onCommit={(next) => {
              // Tanggal uji tidak boleh setelah hari ini (server menolak seluruh potongan pertama bila ada).
              const today = todayWib();
              onFiltersChange({ testDate: next > today ? today : next });
            }}
          />
        </FilterChip>
      </FilterBar>
      <div className="flex items-center gap-2 px-1">
        <Checkbox
          id="wh-hide-recorded"
          checked={filters.hideRecorded}
          disabled={frozen}
          onCheckedChange={(checked) => onFiltersChange({ hideRecorded: checked === true })}
        />
        <Label htmlFor="wh-hide-recorded" className="text-sm font-normal">
          Sembunyikan yang sudah tercatat WH di BU ini
        </Label>
      </div>
    </>
  );
  if (phone) {
    return (
      <>
        {itemBlock}
        {scan}
        <div className="space-y-3">{rest}</div>
      </>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {itemBlock}
        <div>{scan}</div>
      </div>
      {rest}
    </div>
  );
}

function TestDateField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useChipDraft<string>(value, onCommit);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="wh-filter-test-date" className="text-xs text-muted-foreground">
        Tanggal uji
      </Label>
      <Input
        id="wh-filter-test-date"
        type="date"
        max={todayWib()}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}
