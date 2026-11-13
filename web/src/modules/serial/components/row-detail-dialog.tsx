import { SERIAL_LIMITS } from '@shared/serials';
import { useEffect, useState } from 'react';
import { FieldError } from '@/components/field-error';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StagingRow, StagingSticker } from '../lib/draft';
import { RECORD_STATUS_OPTIONS } from '../lib/labels';
import { ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';
import { defaultStickerChoice, StickerChecklist, useApplicableStickers } from './sticker-checklist';

export interface RowDetailResult {
  item: ItemBuValue;
  location: { id: string; label: string };
  status: 'good' | 'failed';
  damage: string;
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
  const [status, setStatus] = useState<'good' | 'failed'>(row.status);
  const [damage, setDamage] = useState(row.damage);
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

  const damageMissing = status === 'failed' && damage.trim() === '';
  const incomplete = item.itemId === '' || item.buId === '' || location.id === '' || damageMissing;
  const ready = !incomplete && loaded && chosen !== null;

  function apply() {
    const stickers: StagingSticker[] = options.flatMap((sticker) => {
      const qty = current.get(sticker.id);
      return qty === undefined ? [] : [{ stickerId: sticker.id, name: sticker.name, qty }];
    });
    onApply({ item, location, status, damage: status === 'failed' ? damage.trim() : '', stickers });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail baris {row.serial}</DialogTitle>
          <DialogDescription>
            Item, lokasi, status, dan stiker yang ditempel pada serial ini. Stok stiker dipotong
            sebanyak jumlah yang dicentang saat disimpan.
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
          <Select
            id="detail-status"
            label="Status baris"
            value={status}
            options={RECORD_STATUS_OPTIONS}
            onValueChange={(next) => setStatus(next === 'failed' ? 'failed' : 'good')}
          />
          {status === 'failed' ? (
            <div className="space-y-1.5">
              <Label htmlFor="detail-damage">Kerusakan</Label>
              <Input
                id="detail-damage"
                value={damage}
                maxLength={SERIAL_LIMITS.damageMax}
                aria-invalid={damageMissing ? true : undefined}
                onChange={(event) => setDamage(event.target.value.replace(/[\r\n]+/g, ' '))}
              />
              <FieldError errors={[damageMissing ? 'Isi dulu kerusakannya' : undefined]} />
            </div>
          ) : null}
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
