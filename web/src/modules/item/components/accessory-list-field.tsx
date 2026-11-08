import type { ItemAccessoryDto } from '@shared/contract';
import { ITEM_LIMITS } from '@shared/items';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rowOfError } from '../lib/row-error';

export interface AccessoryListFieldProps {
  value: readonly ItemAccessoryDto[];
  onChange: (rows: ItemAccessoryDto[]) => void;
  /** Pesan galat daftar; bila berbentuk "Kelengkapan N: ...", input baris N ditandai `aria-invalid`. */
  error?: string | undefined;
}

/** Jumlah apa adanya dari teks input (pecahan tidak dipotong diam-diam); kosong menjadi 0. Skema yang menolak yang tak sah. */
function toQty(text: string): number {
  return text.trim() === '' ? 0 : Number(text);
}

/** Kelengkapan aksesoris: nama dan jumlah per unit. */
export function AccessoryListField({ value, onChange, error }: AccessoryListFieldProps) {
  const invalidRow = rowOfError(error, 'Kelengkapan');
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
            aria-invalid={invalidRow === index ? true : undefined}
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
            aria-invalid={invalidRow === index ? true : undefined}
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
