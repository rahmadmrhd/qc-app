import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { LinkField, type LinkOption } from '@/components/link-field';
import { FilterChip } from '@/components/page/filter-bar';
import { Select } from '@/components/select';
import type { ItemListFilter } from '../queries';

type FilterPatch = Partial<
  Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook' | 'postel'>
>;

export interface ItemFiltersProps {
  filter: Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook'> &
    Partial<Pick<ItemListFilter, 'postel'>>;
  /** Katalog untuk filter stiker/jenis; tidak dipakai bila `showStickerFilter` false. */
  stickers: readonly StickerDto[];
  types: readonly StickerTypeDto[];
  /** False bila user tak boleh membaca katalog: filter stiker/jenis dan mode disembunyikan. */
  showStickerFilter?: boolean;
  onChange: (patch: FilterPatch) => void;
}

const INACTIVE = ' — nonaktif';

interface Group {
  id: string;
  name: string;
  inactive: boolean;
  stickers: StickerDto[];
}

/** Jenis (berurutan seperti katalog) beserta stikernya; stiker berjenis tak dikenal dikelompokkan menurut `typeName`. */
function groupByType(stickers: readonly StickerDto[], types: readonly StickerTypeDto[]): Group[] {
  const groups = new Map<string, Group>(
    types.map((type) => [
      type.id,
      { id: type.id, name: type.name, inactive: type.status === 'inactive', stickers: [] },
    ]),
  );
  for (const sticker of stickers) {
    const group = groups.get(sticker.typeId);
    if (group) group.stickers.push(sticker);
    else {
      groups.set(sticker.typeId, {
        id: sticker.typeId,
        name: sticker.typeName,
        inactive: false,
        stickers: [sticker],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Filter instruksi stiker, Manual Book, Postel, dan stiker/jenis pada halaman daftar item, masing-masing satu
 * `FilterChip` (popover berisi kontrol). Pilihan stiker-atau-jenis merujuk record model lain, jadi memakai `LinkField`
 * (keputusan pemilik 2026-11-11: aturan LinkField berlaku juga untuk filter halaman daftar); pilihan tetap memakai
 * `Select`. Chip yang terisi punya tombol hapus sendiri.
 */
export function ItemFilters({
  filter,
  stickers,
  types,
  showStickerFilter = true,
  onChange,
}: ItemFiltersProps) {
  const groups = showStickerFilter ? groupByType(stickers, types) : [];
  const stickerOptions: LinkOption[] = groups.flatMap((group) => [
    { id: `t:${group.id}`, label: `Semua jenis ${group.name}${group.inactive ? INACTIVE : ''}` },
    ...group.stickers.map((sticker) => ({
      id: `s:${sticker.id}`,
      label: `${sticker.name}${sticker.status === 'active' ? '' : INACTIVE}`,
      description: group.name,
    })),
  ]);
  const known = new Set(stickerOptions.map((option) => option.id));
  const unknown = showStickerFilter && filter.stickerKey !== '' && !known.has(filter.stickerKey);
  const stickerLabel = (key: string): string | undefined => {
    if (unknown && key === filter.stickerKey) {
      return key.startsWith('t:') ? 'Jenis tidak dikenal' : 'Stiker tidak dikenal';
    }
    return stickerOptions.find((option) => option.id === key)?.label;
  };
  const postel = filter.postel ?? 'all';

  return (
    <>
      <FilterChip
        label="Instruksi stiker"
        display={filter.instruction === 'none' ? 'Belum ada' : null}
        onClear={() => onChange({ instruction: 'all' })}
      >
        <Select
          id="item-filter-instruction"
          label="Filter instruksi stiker"
          hideLabel
          options={[
            { value: 'all', label: 'Semua item' },
            { value: 'none', label: 'Belum ada instruksi stiker' },
          ]}
          value={filter.instruction}
          onValueChange={(next) => onChange({ instruction: next as 'all' | 'none' })}
        />
      </FilterChip>
      <FilterChip
        label="Manual Book"
        display={filter.manualBook === 'missing' ? 'Belum ada QR' : null}
        onClear={() => onChange({ manualBook: 'all' })}
      >
        <Select
          id="item-filter-manual-book"
          label="Filter Manual Book"
          hideLabel
          options={[
            { value: 'all', label: 'Semua item' },
            { value: 'missing', label: 'Belum ada QR Manual Book' },
          ]}
          value={filter.manualBook}
          onValueChange={(next) => onChange({ manualBook: next as 'all' | 'missing' })}
        />
      </FilterChip>
      <FilterChip
        label="Postel"
        display={postel === 'missing' ? 'Belum ada' : null}
        onClear={() => onChange({ postel: 'all' })}
      >
        <Select
          id="item-filter-postel"
          label="Filter Postel"
          hideLabel
          options={[
            { value: 'all', label: 'Semua item' },
            { value: 'missing', label: 'Belum ada Postel' },
          ]}
          value={postel}
          onValueChange={(next) => onChange({ postel: next as 'all' | 'missing' })}
        />
      </FilterChip>
      {showStickerFilter ? (
        <FilterChip
          label="Stiker/Jenis"
          display={
            filter.stickerKey === ''
              ? null
              : `${stickerLabel(filter.stickerKey) ?? filter.stickerKey} (${filter.stickerMode === 'has' ? 'memakai' : 'belum memakai'})`
          }
          onClear={() => onChange({ stickerKey: '', stickerMode: 'has' })}
        >
          <div className="space-y-2">
            <LinkField
              id="item-filter-sticker"
              label="Filter stiker atau jenis"
              hideLabel
              placeholder="Semua stiker"
              options={stickerOptions}
              localFilter
              highlight
              value={filter.stickerKey === '' ? null : filter.stickerKey}
              labelOf={(key) =>
                unknown && key === filter.stickerKey ? stickerLabel(key) : undefined
              }
              onChange={(next) => onChange({ stickerKey: next ?? '' })}
            />
            {filter.stickerKey !== '' ? (
              <Select
                id="item-filter-sticker-mode"
                label="Mode filter stiker"
                hideLabel
                options={[
                  { value: 'has', label: 'Memakai' },
                  { value: 'missing', label: 'Belum memakai' },
                ]}
                value={filter.stickerMode}
                onValueChange={(next) => onChange({ stickerMode: next as 'has' | 'missing' })}
              />
            ) : null}
          </div>
        </FilterChip>
      ) : null}
    </>
  );
}
