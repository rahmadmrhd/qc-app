import { ITEM_LIMITS } from '@shared/items';
import type { ItemStickerDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImagePicker } from './image-picker';

export interface StickerListFieldProps {
  value: readonly ItemStickerDto[];
  onChange: (rows: ItemStickerDto[]) => void;
}

/** Stiker yang perlu ditempel: nama, catatan posisi/ketentuan, dan gambar contoh opsional. */
export function StickerListField({ value, onChange }: StickerListFieldProps) {
  const update = (index: number, patch: Partial<ItemStickerDto>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada stiker.</p>
      ) : null}
      {value.map((row, index) => (
        <fieldset
          // biome-ignore lint/suspicious/noArrayIndexKey: baris stiker tidak punya id stabil
          key={index}
          aria-label={`Stiker ${index + 1}`}
          className="space-y-2 rounded-lg border p-3"
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Nama stiker ${index + 1}`}
              placeholder="Nama stiker"
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Hapus stiker ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Hapus
            </Button>
          </div>
          <Input
            aria-label={`Catatan stiker ${index + 1}`}
            placeholder="Posisi atau ketentuan penempelan"
            value={row.note}
            onChange={(event) => update(index, { note: event.target.value })}
          />
          <ImagePicker
            label={`stiker ${index + 1}`}
            value={row.fileId}
            onChange={(fileId) => update(index, { fileId })}
          />
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= ITEM_LIMITS.stickers}
        onClick={() => onChange([...value, { name: '', note: '', fileId: null }])}
      >
        Tambah stiker
      </Button>
    </div>
  );
}
