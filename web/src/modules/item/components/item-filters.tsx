import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import type { ItemListFilter } from '../queries';

type FilterPatch = Partial<Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode'>>;

export interface ItemFiltersProps {
  filter: Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode'>;
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
 * (dikelompokkan per jenis) dan mode Memakai/Belum memakai. Ini filter halaman, bukan field form: `NativeSelect`
 * dibenarkan (pengecualian aturan LinkField, spek 3b-2 §3).
 */
export function ItemFilters({
  filter,
  stickers,
  types,
  showStickerFilter = true,
  onChange,
}: ItemFiltersProps) {
  const groups = showStickerFilter ? groupByType(stickers, types) : [];
  const known = new Set(
    groups.flatMap((group) => [`t:${group.id}`, ...group.stickers.map((s) => `s:${s.id}`)]),
  );
  const unknown = showStickerFilter && filter.stickerKey !== '' && !known.has(filter.stickerKey);
  const active =
    filter.instruction !== 'all' || filter.stickerKey !== '' || filter.stickerMode !== 'has';

  return (
    <>
      <NativeSelect
        aria-label="Filter instruksi stiker"
        className="sm:w-56"
        value={filter.instruction}
        onChange={(event) => onChange({ instruction: event.target.value as 'all' | 'none' })}
      >
        <option value="all">Semua item</option>
        <option value="none">Belum ada instruksi stiker</option>
      </NativeSelect>
      {showStickerFilter ? (
        <NativeSelect
          aria-label="Filter stiker atau jenis"
          className="sm:w-64"
          value={filter.stickerKey}
          onChange={(event) => onChange({ stickerKey: event.target.value })}
        >
          <option value="">Semua stiker</option>
          {unknown ? (
            <option value={filter.stickerKey}>
              {filter.stickerKey.startsWith('t:') ? 'Jenis tidak dikenal' : 'Stiker tidak dikenal'}
            </option>
          ) : null}
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              <option value={`t:${group.id}`}>
                {`Semua jenis ${group.name}${group.inactive ? INACTIVE : ''}`}
              </option>
              {group.stickers.map((sticker) => (
                <option key={sticker.id} value={`s:${sticker.id}`}>
                  {`${sticker.name}${sticker.status === 'inactive' ? INACTIVE : ''}`}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      ) : null}
      {showStickerFilter && filter.stickerKey !== '' ? (
        <NativeSelect
          aria-label="Mode filter stiker"
          className="sm:w-40"
          value={filter.stickerMode}
          onChange={(event) => onChange({ stickerMode: event.target.value as 'has' | 'missing' })}
        >
          <option value="has">Memakai</option>
          <option value="missing">Belum memakai</option>
        </NativeSelect>
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange({ instruction: 'all', stickerKey: '', stickerMode: 'has' })}
        >
          Bersihkan filter
        </Button>
      ) : null}
    </>
  );
}
