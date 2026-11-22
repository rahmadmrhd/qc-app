import type { BrandDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { LinkField, LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { Select } from '@/components/select';
import type { ItemListFilter } from '../queries';

type FilterPatch = Partial<
  Pick<
    ItemListFilter,
    'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook' | 'postel' | 'brandIds' | 'buIds'
  >
>;

export interface ItemFiltersProps {
  filter: Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook'> &
    Partial<Pick<ItemListFilter, 'postel' | 'brandIds' | 'buIds'>>;
  /** Pilihan chip Merk (merk hidup); chip tak tampil bila tidak diberikan. */
  brands?: readonly BrandDto[] | undefined;
  /**
   * Satu merk dari `filter.brandIds` yang tak ada di `brands` (mis. merk terhapus dari tautan View merk), dimuat lewat
   * `brands.get`; dipakai hanya untuk nama chip (terhapus = penanda "Terhapus"). Kosong = "Merk tidak dikenal".
   */
  knownBrand?: BrandDto | undefined;
  /** Pilihan chip Business Unit (BU hidup yang boleh dilihat user); chip tak tampil bila tidak diberikan. */
  businessUnits?: readonly { id: string; code: string; name: string }[] | undefined;
  /** Katalog untuk filter stiker/jenis; tidak dipakai bila `showStickerFilter` false. */
  stickers: readonly StickerDto[];
  types: readonly StickerTypeDto[];
  /** False bila user tak boleh membaca katalog: filter stiker/jenis dan mode disembunyikan. */
  showStickerFilter?: boolean;
  onChange: (patch: FilterPatch) => void;
}

const INACTIVE = ' — nonaktif';
const DELETED = ' — Terhapus';

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
  brands,
  knownBrand,
  businessUnits,
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
  const brandIds = filter.brandIds ?? [];
  const buIds = filter.buIds ?? [];
  const brandOptions: LinkOption[] = (brands ?? []).map((brand) => ({
    id: brand.id,
    label: brand.status === 'active' ? brand.name : `${brand.name}${INACTIVE}`,
  }));
  const buOptions: LinkOption[] = (businessUnits ?? []).map((bu) => ({
    id: bu.id,
    label: `${bu.name} (${bu.code})`,
  }));
  // Id dari URL yang tak ada di pilihan (mis. merk terhapus dari tautan View merk) tetap tampil sebagai tidak dikenal.
  const brandName = (id: string) => {
    const option = brandOptions.find((entry) => entry.id === id);
    if (option) return option.label;
    if (knownBrand?.id !== id) return undefined;
    return knownBrand.deleted ? `${knownBrand.name}${DELETED}` : knownBrand.name;
  };
  const buName = (id: string) => buOptions.find((option) => option.id === id)?.label;

  return (
    <>
      {brands ? (
        <FilterChip
          label="Merk"
          display={multiFilterDisplay(brandIds.map((id) => brandName(id) ?? 'Merk tidak dikenal'))}
          onClear={() => onChange({ brandIds: [] })}
        >
          <LinkMultiField
            id="item-filter-brand"
            label="Filter merk"
            hideLabel
            placeholder="Semua merk"
            options={brandOptions}
            localFilter
            highlight
            value={brandIds}
            labelOf={(id) => brandName(id) ?? 'Merk tidak dikenal'}
            onChange={(next) => onChange({ brandIds: next })}
          />
        </FilterChip>
      ) : null}
      {businessUnits ? (
        <FilterChip
          label="Business Unit"
          display={multiFilterDisplay(buIds.map((id) => buName(id) ?? 'BU tidak dikenal'))}
          onClear={() => onChange({ buIds: [] })}
        >
          <LinkMultiField
            id="item-filter-bu"
            label="Filter business unit"
            hideLabel
            placeholder="Semua BU"
            options={buOptions}
            localFilter
            highlight
            value={buIds}
            labelOf={(id) => buName(id) ?? 'BU tidak dikenal'}
            onChange={(next) => onChange({ buIds: next })}
          />
        </FilterChip>
      ) : null}
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
