import { piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Hitungan awal: satu baris lembar kosong dan tanpa butir lepas. */
export function emptyCount(): StockCount {
  return { rows: [{ sheets: 0, perSheet: 0 }], loose: 0 };
}

/** Membuang baris yang tidak menyumbang butir (lembar atau isi 0) sebelum dikirim ke server. */
export function cleanCount(count: StockCount): StockCount {
  return {
    rows: count.rows.filter((row) => row.sheets * row.perSheet > 0),
    loose: count.loose,
  };
}

/** Teks angka -> bilangan bulat tidak negatif (kosong/tidak valid = 0), dibatasi `qtyMax`. */
function toCountPart(text: string): number {
  const value = Math.floor(Number(text));
  return Number.isFinite(value) && value > 0 ? Math.min(value, STICKER_LIMITS.qtyMax) : 0;
}

const show = (value: number): string => (value === 0 ? '' : String(value));

export interface CountInputProps {
  value: StockCount;
  onChange: (next: StockCount) => void;
}

/** Hitungan stok: baris "lembar x isi per lembar" (dapat ditambah) dan butir lepas; jumlah butir tampil langsung. */
export function CountInput({ value, onChange }: CountInputProps) {
  const total = piecesOfCount(value);
  const looseId = useId();

  function setRow(index: number, patch: Partial<StockCount['rows'][number]>) {
    onChange({
      ...value,
      rows: value.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    });
  }

  return (
    <div className="space-y-2">
      {value.rows.map((row, index) => (
        // Baris tak punya identitas lain; urutan stabil dan hanya dihapus lewat tombolnya.
        // biome-ignore lint/suspicious/noArrayIndexKey: baris hitungan tanpa id
        <div key={index} className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Lembar"
            aria-label={`Lembar baris ${index + 1}`}
            className="w-24"
            value={show(row.sheets)}
            onChange={(event) => setRow(index, { sheets: toCountPart(event.target.value) })}
          />
          <span aria-hidden="true">×</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Isi per lembar"
            aria-label={`Isi per lembar baris ${index + 1}`}
            className="w-28"
            value={show(row.perSheet)}
            onChange={(event) => setRow(index, { perSheet: toCountPart(event.target.value) })}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Hapus baris ${index + 1}`}
            onClick={() => onChange({ ...value, rows: value.rows.filter((_, at) => at !== index) })}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={value.rows.length >= STICKER_LIMITS.countRows}
        onClick={() => onChange({ ...value, rows: [...value.rows, { sheets: 0, perSheet: 0 }] })}
      >
        <Plus aria-hidden="true" />
        Tambah baris
      </Button>
      <div className="flex items-center gap-2">
        <label htmlFor={looseId} className="text-sm">
          Butir
        </label>
        <Input
          id={looseId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="0"
          className="w-28"
          value={show(value.loose)}
          onChange={(event) => onChange({ ...value, loose: toCountPart(event.target.value) })}
        />
      </div>
      <p className="text-sm font-medium" aria-live="polite">
        {`${total} butir`}
      </p>
    </div>
  );
}
