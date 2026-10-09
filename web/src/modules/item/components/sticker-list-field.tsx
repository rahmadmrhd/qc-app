import { ITEM_LIMITS } from '@shared/items';
import type { ItemStickerDto } from '@shared/rpc';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImagePicker } from './image-picker';

export interface StickerListFieldProps {
  value: readonly ItemStickerDto[];
  onChange: (rows: ItemStickerDto[]) => void;
}

/** Stiker yang perlu ditempel: nama, catatan posisi/ketentuan, dan gambar contoh opsional. */
export function StickerListField({ value, onChange }: StickerListFieldProps) {
  // Nilai terbaru (tahan balapan dengan unggah gambar) dan kunci stabil per baris agar unggahan yang selesai
  // belakangan jatuh ke baris yang benar walau baris lain dihapus.
  const valueRef = useRef(value);
  valueRef.current = value;
  const keysRef = useRef<number[]>([]);
  const nextKey = useRef(1);
  while (keysRef.current.length < value.length) keysRef.current.push(nextKey.current++);
  keysRef.current.length = value.length;
  const keys = keysRef.current;

  const commit = (next: ItemStickerDto[]) => {
    valueRef.current = next;
    onChange(next);
  };
  const update = (key: number, patch: Partial<ItemStickerDto>) => {
    const index = keysRef.current.indexOf(key);
    if (index < 0) return;
    commit(valueRef.current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (key: number) => {
    const index = keysRef.current.indexOf(key);
    if (index < 0) return;
    keysRef.current.splice(index, 1);
    commit(valueRef.current.filter((_, i) => i !== index));
  };
  const add = () => {
    keysRef.current.push(nextKey.current++);
    commit([...valueRef.current, { name: '', note: '', fileId: null }]);
  };
  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada stiker.</p>
      ) : null}
      {value.map((row, index) => {
        const key = keys[index] ?? -1;
        return (
          <fieldset
            key={key}
            aria-label={`Stiker ${index + 1}`}
            className="space-y-2 rounded-lg border p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Nama stiker ${index + 1}`}
                placeholder="Nama stiker"
                value={row.name}
                onChange={(event) => update(key, { name: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Hapus stiker ${index + 1}`}
                onClick={() => remove(key)}
              >
                Hapus
              </Button>
            </div>
            <Input
              aria-label={`Catatan stiker ${index + 1}`}
              placeholder="Posisi atau ketentuan penempelan"
              value={row.note}
              onChange={(event) => update(key, { note: event.target.value })}
            />
            <ImagePicker
              label={`stiker ${index + 1}`}
              value={row.fileId}
              onChange={(fileId) => update(key, { fileId })}
            />
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= ITEM_LIMITS.stickers}
        onClick={add}
      >
        Tambah stiker
      </Button>
    </div>
  );
}
