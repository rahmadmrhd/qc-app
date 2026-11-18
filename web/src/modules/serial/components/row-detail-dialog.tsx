import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StagingRow, StagingSticker } from '../lib/draft';
import { ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';
import { defaultStickerChoice, StickerChecklist, useApplicableStickers } from './sticker-checklist';

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
    proofMin: row.proofMin ?? 0,
  });
  const [location, setLocation] = useState({ id: row.locationId, label: row.locationLabel });
  // Jumlah per stiker yang tercentang; stiker yang tak ada di peta = tak dicentang.
  const [chosen, setChosen] = useState<Map<string, number> | null>(() =>
    row.stickers === null ? null : new Map(row.stickers.map((s) => [s.stickerId, s.qty])),
  );
  const { options, state, loaded } = useApplicableStickers(item.itemId, item.buId);

  // Item/BU diganti: pilihan lama tidak berlaku lagi, kembali ke bawaan (semua tercentang).
  function changeItem(next: ItemBuValue) {
    if (next.itemId !== item.itemId || next.buId !== item.buId) setChosen(null);
    setItem(next);
  }

  // Bawaan (belum ada pilihan eksplisit): semua stiker yang berlaku tercentang dengan jumlah awalnya.
  useEffect(() => {
    if (chosen === null && loaded) setChosen(defaultStickerChoice(options));
  }, [chosen, loaded, options]);

  const current = chosen ?? new Map<string, number>();

  const incomplete = item.itemId === '' || item.buId === '' || location.id === '';
  const ready = !incomplete && loaded && chosen !== null;

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
          <StickerChecklist
            idPrefix="detail"
            state={state}
            options={options}
            chosen={current}
            onChange={setChosen}
          />
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
