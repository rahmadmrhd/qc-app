import { SERIAL_LIMITS } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StagingRow, StagingSticker } from '../lib/draft';
import { serialStickerOptionsQueryOptions } from '../queries';
import { ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';

export interface RowDetailResult {
  item: ItemBuValue;
  location: { id: string; label: string };
  stickers: StagingSticker[];
}

export interface RowDetailDialogProps {
  row: StagingRow;
  onClose: () => void;
  onApply: (result: RowDetailResult) => void;
}

/** Pilihan stiker per baris: stiker yang berlaku bagi (item, BU), bawaan semua tercentang jumlah 1. */
export function RowDetailDialog({ row, onClose, onApply }: RowDetailDialogProps) {
  const [item, setItem] = useState<ItemBuValue>({
    itemId: row.itemId,
    itemLabel: row.itemLabel,
    buId: row.buId,
    buLabel: row.buLabel,
  });
  const [location, setLocation] = useState({ id: row.locationId, label: row.locationLabel });
  // Jumlah per stiker yang tercentang; stiker yang tak ada di peta = tak dicentang.
  const [chosen, setChosen] = useState<Map<string, number> | null>(() =>
    row.stickers === null ? null : new Map(row.stickers.map((s) => [s.stickerId, s.qty])),
  );
  const { data, isFetching, isError } = useQuery(
    serialStickerOptionsQueryOptions(item.itemId, item.buId),
  );
  const options = data?.stickers ?? [];

  // Item/BU diganti: pilihan lama tidak berlaku lagi, kembali ke bawaan (semua tercentang).
  function changeItem(next: ItemBuValue) {
    if (next.itemId !== item.itemId || next.buId !== item.buId) setChosen(null);
    setItem(next);
  }

  // Bawaan (belum ada pilihan eksplisit): semua stiker yang berlaku tercentang dengan jumlah awalnya.
  useEffect(() => {
    if (chosen === null && data) {
      setChosen(new Map(data.stickers.map((sticker) => [sticker.id, sticker.defaultQty])));
    }
  }, [chosen, data]);

  const current = chosen ?? new Map<string, number>();

  function toggle(id: string, defaultQty: number, on: boolean) {
    const next = new Map(current);
    if (on) next.set(id, next.get(id) ?? defaultQty);
    else next.delete(id);
    setChosen(next);
  }

  function setQty(id: string, qty: number) {
    const next = new Map(current);
    next.set(id, Math.min(SERIAL_LIMITS.stickerQtyMax, Math.max(1, qty)));
    setChosen(next);
  }

  const incomplete = item.itemId === '' || item.buId === '' || location.id === '';
  const ready = !incomplete && !isFetching && !isError && data !== undefined && chosen !== null;

  function apply() {
    const stickers: StagingSticker[] = options.flatMap((sticker) => {
      const qty = current.get(sticker.id);
      return qty === undefined ? [] : [{ stickerId: sticker.id, name: sticker.name, qty }];
    });
    onApply({ item, location, stickers });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail baris {row.serial}</DialogTitle>
          <DialogDescription>
            Item, lokasi, dan stiker yang ditempel pada serial ini. Stok stiker dipotong sebanyak
            jumlah yang dicentang saat disimpan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ItemBuField
            idPrefix="detail"
            label="Item baris"
            buFieldLabel="Business Unit baris"
            value={item}
            onChange={changeItem}
          />
          <SerialLocationField
            id="detail-location"
            label="Lokasi baris"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Stiker yang ditempel</legend>
            {item.itemId === '' || item.buId === '' ? (
              <p className="text-sm text-muted-foreground">
                Pilih item dan Business Unit untuk melihat stiker yang berlaku.
              </p>
            ) : isError ? (
              <p role="alert" className="text-sm text-destructive">
                Stiker yang berlaku gagal dimuat.
              </p>
            ) : isFetching && data === undefined ? (
              <p className="text-sm text-muted-foreground">Memuat stiker…</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada stiker yang berlaku bagi item ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {options.map((sticker) => {
                  const qty = current.get(sticker.id);
                  const checked = qty !== undefined;
                  const label = sticker.alias ? `${sticker.name} (${sticker.alias})` : sticker.name;
                  return (
                    <li key={sticker.id} className="flex items-center gap-3">
                      <Checkbox
                        id={`sticker-${sticker.id}`}
                        checked={checked}
                        aria-label={label}
                        onCheckedChange={(on) =>
                          toggle(sticker.id, sticker.defaultQty, on === true)
                        }
                      />
                      <label htmlFor={`sticker-${sticker.id}`} className="min-w-0 flex-1 text-sm">
                        <span className="block truncate">{label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {sticker.typeName}
                        </span>
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
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
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={!ready} onClick={apply}>
            Terapkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
