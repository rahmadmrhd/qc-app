import { ITEM_LIMITS } from '@shared/items';
import type { ItemAccessoryDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface AccessoryListFieldProps {
  value: readonly ItemAccessoryDto[];
  onChange: (rows: ItemAccessoryDto[]) => void;
}

/** Jumlah dari teks input: bilangan bulat tak negatif; kosong atau tidak valid menjadi 0 (ditolak skema). */
function toQty(text: string): number {
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/** Kelengkapan aksesoris: nama dan jumlah per unit. */
export function AccessoryListField({ value, onChange }: AccessoryListFieldProps) {
  const update = (index: number, patch: Partial<ItemAccessoryDto>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada kelengkapan.</p>
      ) : null}
      {value.map((row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: baris kelengkapan tidak punya id stabil
          key={index}
          className="flex items-center gap-2"
        >
          <Input
            aria-label={`Nama kelengkapan ${index + 1}`}
            placeholder="Nama kelengkapan"
            value={row.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Input
            type="number"
            min={1}
            max={ITEM_LIMITS.accessoryQty}
            className="w-24"
            aria-label={`Jumlah kelengkapan ${index + 1}`}
            value={row.qty === 0 ? '' : row.qty}
            onChange={(event) => update(index, { qty: toQty(event.target.value) })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Hapus kelengkapan ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Hapus
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= ITEM_LIMITS.accessories}
        onClick={() => onChange([...value, { name: '', qty: 1 }])}
      >
        Tambah kelengkapan
      </Button>
    </div>
  );
}
