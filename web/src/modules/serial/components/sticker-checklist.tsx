import type { ApplicableStickerDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { serialStickerOptionsQueryOptions } from '../queries';

export type StickerListState = 'none' | 'error' | 'loading' | 'empty' | 'ready';

export interface ApplicableStickers {
  options: ApplicableStickerDto[];
  state: StickerListState;
  /** Daftar sudah termuat tanpa galat dan tidak sedang dimuat ulang. */
  loaded: boolean;
}

/** Stiker yang berlaku bagi (item, BU; plus `serialId` pada Cek ulang) lewat `serials.stickerOptions`; `none` bila item atau BU belum dipilih. */
export function useApplicableStickers(
  itemId: string,
  buId: string,
  serialId?: string,
): ApplicableStickers {
  const { data, isFetching, isError } = useQuery(
    serialStickerOptionsQueryOptions(itemId, buId, serialId),
  );
  const options = data?.stickers ?? [];
  const state: StickerListState =
    itemId === '' || buId === ''
      ? 'none'
      : isError
        ? 'error'
        : isFetching && data === undefined
          ? 'loading'
          : options.length === 0
            ? 'empty'
            : 'ready';
  return { options, state, loaded: data !== undefined && !isFetching && !isError };
}

/** Bawaan pilihan stiker: semua yang berlaku tercentang dengan jumlah awalnya. */
export function defaultStickerChoice(
  options: readonly ApplicableStickerDto[],
): Map<string, number> {
  return new Map(options.map((sticker) => [sticker.id, sticker.defaultQty]));
}

export interface StickerChecklistProps {
  /** Awalan id elemen (beberapa daftar dapat tampil bersamaan di halaman yang sama). */
  idPrefix: string;
  state: StickerListState;
  options: readonly ApplicableStickerDto[];
  /** Jumlah per stiker yang tercentang; stiker yang tak ada di peta = tak dicentang. */
  chosen: ReadonlyMap<string, number>;
  onChange: (next: Map<string, number>) => void;
}

/**
 * Daftar centang stiker yang ditempel (dipakai dialog Detail baris dan bawaan rombongan): centang, jumlah, dan keterangan
 * bila item/BU belum dipilih, stiker belum termuat, atau tidak ada stiker yang berlaku.
 */
export function StickerChecklist({
  idPrefix,
  state,
  options,
  chosen,
  onChange,
}: StickerChecklistProps) {
  function toggle(id: string, defaultQty: number, on: boolean) {
    const next = new Map(chosen);
    if (on) next.set(id, next.get(id) ?? defaultQty);
    else next.delete(id);
    onChange(next);
  }

  function setQty(id: string, qty: number) {
    const next = new Map(chosen);
    next.set(id, Math.min(SERIAL_LIMITS.stickerQtyMax, Math.max(1, qty)));
    onChange(next);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Stiker yang ditempel</legend>
      {state === 'none' ? (
        <p className="text-sm text-muted-foreground">
          Pilih item dan Business Unit untuk melihat stiker yang berlaku.
        </p>
      ) : state === 'error' ? (
        <p role="alert" className="text-sm text-destructive-text">
          Stiker yang berlaku gagal dimuat.
        </p>
      ) : state === 'loading' ? (
        <p className="text-sm text-muted-foreground">Memuat stiker…</p>
      ) : state === 'empty' ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada stiker yang berlaku bagi item ini.
        </p>
      ) : (
        <ul className="space-y-2">
          {options.map((sticker) => {
            const qty = chosen.get(sticker.id);
            const checked = qty !== undefined;
            const label = sticker.alias ? `${sticker.name} (${sticker.alias})` : sticker.name;
            const id = `${idPrefix}-sticker-${sticker.id}`;
            return (
              <li key={sticker.id} className="flex items-center gap-3">
                <Checkbox
                  id={id}
                  checked={checked}
                  aria-label={label}
                  onCheckedChange={(on) => toggle(sticker.id, sticker.defaultQty, on === true)}
                />
                <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {sticker.typeName}
                  </span>
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    color="primary"
                    size="icon-xs"
                    aria-label={`Kurangi ${label}`}
                    disabled={!checked || (qty ?? 1) <= 1}
                    onClick={() => setQty(sticker.id, (qty ?? 1) - 1)}
                  >
                    <Minus aria-hidden />
                  </Button>
                  <output
                    aria-label={`Jumlah ${label}`}
                    className="w-6 text-center text-sm tabular-nums"
                  >
                    {qty ?? 0}
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    color="primary"
                    size="icon-xs"
                    aria-label={`Tambah ${label}`}
                    disabled={!checked || (qty ?? 1) >= SERIAL_LIMITS.stickerQtyMax}
                    onClick={() => setQty(sticker.id, (qty ?? 1) + 1)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
