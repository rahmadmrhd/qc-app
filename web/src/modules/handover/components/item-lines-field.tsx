import { HANDOVER_LIMITS } from '@shared/handover';
import type { HandoverOptionItemDto } from '@shared/rpc';
import { suggestMatches } from '@shared/suggest';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ItemLine {
  itemId: string;
  /** Salinan "merk tipe" untuk tampilan. */
  label: string;
  qty: number;
}

export interface ItemLinesFieldProps {
  options: readonly HandoverOptionItemDto[];
  value: readonly ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  /** Tautan "Tambah item baru" (hanya bila user boleh membuat item); `null` = tidak ada. */
  createItemLink?: ReactNode;
}

const labelOf = (item: HandoverOptionItemDto) => `${item.brand} ${item.model}`.trim();

/** Daftar baris `tipe × qty`: tipe dipilih dari saran toleran atas katalog (merk, tipe, nama lain). */
export function ItemLinesField({ options, value, onChange, createItemLink }: ItemLinesFieldProps) {
  const [query, setQuery] = useState('');
  const full = value.length >= HANDOVER_LIMITS.lines;
  const used = new Set(value.map((line) => line.itemId));
  const available = options.filter((item) => !used.has(item.id));
  const suggestions = suggestMatches(
    available,
    query,
    (item) => [item.brand, item.model, ...item.aliases],
    8,
  );
  const hasQuery = query.trim() !== '';
  const matchedButUsed =
    hasQuery &&
    suggestions.length === 0 &&
    suggestMatches(options, query, (item) => [item.brand, item.model, ...item.aliases], 1).length >
      0;

  function add(item: HandoverOptionItemDto) {
    onChange([...value, { itemId: item.id, label: labelOf(item), qty: 1 }]);
    setQuery('');
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada tipe. Cari dan pilih tipe di bawah.
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((line) => (
            <li key={line.itemId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={HANDOVER_LIMITS.qtyMax}
                className="w-28"
                aria-label={`Qty ${line.label}`}
                value={Number.isNaN(line.qty) ? '' : line.qty}
                onChange={(event) =>
                  onChange(
                    value.map((row) =>
                      row.itemId === line.itemId
                        ? { ...row, qty: Number(event.target.value) }
                        : row,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Hapus ${line.label}`}
                onClick={() => onChange(value.filter((row) => row.itemId !== line.itemId))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative space-y-1.5">
        <Input
          aria-label="Cari tipe"
          placeholder={full ? 'Batas baris tercapai' : 'Cari tipe: merk, tipe, atau nama lain'}
          autoComplete="off"
          disabled={full}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault(); // jangan mengirim form
              const first = suggestions[0];
              if (first) add(first);
            }
          }}
        />
        {suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Saran tipe"
            className="max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((item) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => add(item)}
                >
                  {labelOf(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {matchedButUsed ? (
          <p className="text-xs text-muted-foreground">
            Semua tipe yang cocok sudah ada di daftar.
          </p>
        ) : null}
        {hasQuery && suggestions.length === 0 && !matchedButUsed ? (
          <p className="text-xs text-muted-foreground">
            Tipe tidak ditemukan di katalog. {createItemLink}
          </p>
        ) : null}
      </div>
    </div>
  );
}
