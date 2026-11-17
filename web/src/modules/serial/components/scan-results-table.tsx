import { normalizeSerial } from '@shared/serials';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { RowProblem, ScanRow } from '../lib/scan-table';

export interface ScanResultsTableProps {
  rows: readonly ScanRow[];
  /** Masalah tiap baris (sejajar dengan `rows`; null = sah). */
  problems: readonly (RowProblem | null)[];
  /** Baris yang baru ditambahkan: disorot sebentar. */
  highlightId: string | null;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Tabel internal hasil scan: No | Serial Number (input yang dapat diedit) | Action (hapus). Menyusut di dalam dialog
 * (`min-h-0 flex-1 overflow-auto`), menggulir otomatis ke baris terbaru, dan menandai baris bermasalah dengan pesan.
 */
export function ScanResultsTable({
  rows,
  problems,
  highlightId,
  onEdit,
  onRemove,
}: ScanResultsTableProps) {
  const lastRef = useRef<HTMLTableRowElement | null>(null);
  const count = rows.length;

  // Baris baru di akhir: gulir ke sana (hanya saat jumlah bertambah, bukan saat mengedit atau menghapus).
  const previousCount = useRef(0);
  useEffect(() => {
    if (count > previousCount.current) lastRef.current?.scrollIntoView?.({ block: 'nearest' });
    previousCount.current = count;
  }, [count]);

  return (
    <div
      data-testid="scan-results"
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t"
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-popover text-left text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            <th scope="col" className="w-12 px-3 py-2 text-center font-medium">
              No
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Serial Number
            </th>
            <th scope="col" className="w-16 px-2 py-2 text-center font-medium">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                Belum ada hasil. Arahkan kamera ke kode.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const problem = problems[index] ?? null;
              const errorId = `scan-row-error-${row.id}`;
              return (
                <tr
                  key={row.id}
                  ref={index === rows.length - 1 ? lastRef : undefined}
                  data-highlight={highlightId === row.id ? 'true' : undefined}
                  className={cn(
                    'border-b align-top transition-colors duration-700',
                    highlightId === row.id && 'bg-emerald-500/20',
                  )}
                >
                  <td className="px-3 py-2 text-center text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label={`Serial nomor ${index + 1}`}
                      aria-invalid={problem !== null}
                      aria-describedby={problem ? errorId : undefined}
                      className={cn(
                        'h-10 font-mono',
                        problem && 'border-destructive text-destructive',
                      )}
                      value={row.text}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      onChange={(event) => onEdit(row.id, event.target.value)}
                      // Bentuk kanonis (huruf besar, MAC tanpa pemisah) ditetapkan saat selesai mengetik.
                      onBlur={() => {
                        const normalized = normalizeSerial(row.text);
                        if (normalized !== row.text) onEdit(row.id, normalized);
                      }}
                    />
                    {problem ? (
                      <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
                        {problem.message}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground hover:text-destructive"
                      aria-label="Hapus serial"
                      title="Hapus serial"
                      onClick={() => onRemove(row.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
