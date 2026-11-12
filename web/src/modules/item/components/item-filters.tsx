import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
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
 * Filter instruksi stiker pada halaman daftar item: "Belum ada instruksi", satu pilihan stiker-atau-jenis
 * dan mode Memakai/Belum memakai. Pilihan stiker-atau-jenis merujuk record model lain, jadi memakai `LinkField`
 * (keputusan pemilik 2026-11-11: aturan LinkField berlaku juga untuk filter halaman daftar); pilihan tetap
 * (semua/belum, Memakai/Belum memakai) memakai `Select`.
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
  const active =
    filter.instruction !== 'all' ||
    filter.stickerKey !== '' ||
    filter.stickerMode !== 'has' ||
    filter.manualBook !== 'all' ||
    (filter.postel ?? 'all') !== 'all';

  return (
    <>
      <Select
        id="item-filter-instruction"
        label="Filter instruksi stiker"
        hideLabel
        className="sm:w-56"
        options={[
          { value: 'all', label: 'Semua item' },
          { value: 'none', label: 'Belum ada instruksi stiker' },
        ]}
        value={filter.instruction}
        onValueChange={(next) => onChange({ instruction: next as 'all' | 'none' })}
      />
      <Select
        id="item-filter-manual-book"
        label="Filter Manual Book"
        hideLabel
        className="sm:w-56"
        options={[
          { value: 'all', label: 'Semua item' },
          { value: 'missing', label: 'Belum ada QR Manual Book' },
        ]}
        value={filter.manualBook}
        onValueChange={(next) => onChange({ manualBook: next as 'all' | 'missing' })}
      />
      <Select
        id="item-filter-postel"
        label="Filter Postel"
        hideLabel
        className="sm:w-48"
        options={[
          { value: 'all', label: 'Semua item' },
          { value: 'missing', label: 'Belum ada Postel' },
        ]}
        value={filter.postel ?? 'all'}
        onValueChange={(next) => onChange({ postel: next as 'all' | 'missing' })}
      />
      {showStickerFilter ? (
        <LinkField
          id="item-filter-sticker"
          label="Filter stiker atau jenis"
          hideLabel
          className="sm:w-64"
          placeholder="Semua stiker"
          options={stickerOptions}
          localFilter
          highlight
          value={filter.stickerKey === '' ? null : filter.stickerKey}
          labelOf={(key) =>
            unknown && key === filter.stickerKey
              ? key.startsWith('t:')
                ? 'Jenis tidak dikenal'
                : 'Stiker tidak dikenal'
              : undefined
          }
          onChange={(next) => onChange({ stickerKey: next ?? '' })}
        />
      ) : null}
      {showStickerFilter && filter.stickerKey !== '' ? (
        <Select
          id="item-filter-sticker-mode"
          label="Mode filter stiker"
          hideLabel
          className="sm:w-40"
          options={[
            { value: 'has', label: 'Memakai' },
            { value: 'missing', label: 'Belum memakai' },
          ]}
          value={filter.stickerMode}
          onValueChange={(next) => onChange({ stickerMode: next as 'has' | 'missing' })}
        />
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChange({
              instruction: 'all',
              stickerKey: '',
              stickerMode: 'has',
              manualBook: 'all',
              postel: 'all',
            })
          }
        >
          Bersihkan filter
        </Button>
      ) : null}
    </>
  );
}
