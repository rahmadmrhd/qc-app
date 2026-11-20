import { cn } from 'cn';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import type { DataColumn, MobileRole } from './data-table';
import { type RowAction, RowActions } from './row-actions';
import { LongPressHint, SelectionBar } from './selection-bar';
import { useLongPressSelect } from './use-long-press-select';
import type { RowSelection } from './use-row-selection';

/** Peran tiap kolom di kartu: yang dinyatakan, selain itu bawaan (lihat `MobileRole`). */
export function resolveMobileRoles<T>(columns: readonly DataColumn<T>[]): MobileRole[] {
  const hasTitle = columns.some((column) => column.mobile === 'title');
  return columns.map((column, index) => {
    if (column.mobile) return column.mobile;
    if (!hasTitle && index === 0) return 'title';
    return column.id === 'status' ? 'badge' : 'meta';
  });
}

/** Sel kosong (null, false, teks kosong, atau hanya anak kosong) tak ditampilkan di kartu. */
function hasContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean' || node === '') return false;
  if (Array.isArray(node)) return node.some(hasContent);
  if (isValidElement(node) && node.type === Fragment) {
    return Children.toArray((node.props as { children?: ReactNode }).children).some(hasContent);
  }
  return true;
}

interface DataCardsProps<T> {
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly DataColumn<T>[];
  label: string;
  nameOf: (row: T) => string;
  selection?: RowSelection | undefined;
  actions?: ((row: T) => readonly RowAction[]) | undefined;
  isLoading?: boolean | undefined;
}

/**
 * Tampilan kartu bertumpuk `DataTable` di < 768 px: judul (tautan), menu "⋯" berlabel di kanan atas, lencana status
 * di bawah judul, lalu pasangan label–nilai dari kolom `meta`. Pilih massal di ponsel (tekan lama) menyusul:
 * `selection` sudah diteruskan (kartu terpilih ditandai `data-state`), interaksinya belum dipasang.
 */
export function DataCards<T>({
  rows,
  rowKey,
  columns,
  label,
  nameOf,
  selection,
  actions,
  isLoading,
}: DataCardsProps<T>) {
  const roles = resolveMobileRoles(columns);
  const { selecting, bind } = useLongPressSelect(selection, true);
  const ids = rows.map(rowKey);
  const byRole = (role: MobileRole) =>
    columns
      .map((column, index) => ({ column, role: roles[index] }))
      .filter((entry) => entry.role === role);
  const titles = byRole('title');
  const badges = byRole('badge');
  const metas = byRole('meta');

  if (isLoading) {
    return (
      <ul aria-label={label} aria-busy="true" className="space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: kartu kerangka tak berurutan
          <li key={index} className="rounded-lg border p-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      {selection && selecting ? <SelectionBar selection={selection} ids={ids} /> : null}
      {selection && !selecting && rows.length > 0 ? <LongPressHint /> : null}
      <ul aria-label={label} className="space-y-2">
        {rows.map((row) => {
          const id = rowKey(row);
          const isSelected = selection?.selected.has(id) ?? false;
          const baseActions = actions?.(row) ?? [];
          // Jalur cadangan non-sentuh: "Pilih" di menu ⋯ masuk mode pilih dengan kartu ini terpilih.
          const rowActions: readonly RowAction[] = selection
            ? [
                ...baseActions,
                {
                  id: 'select',
                  action: 'select',
                  label: `Pilih ${nameOf(row)}`,
                  onSelect: () => selection.toggle(id),
                },
              ]
            : baseActions;
          const metaEntries = metas
            .map(({ column }) => ({ column, content: column.cell(row) }))
            .filter((entry) => hasContent(entry.content));
          const badgeEntries = badges
            .map(({ column }) => ({ column, content: column.cell(row) }))
            .filter((entry) => hasContent(entry.content));
          return (
            <li
              key={id}
              data-state={isSelected ? 'selected' : undefined}
              className={cn(
                'rounded-lg border bg-card p-3 data-[state=selected]:bg-info-text/8',
                selection && 'select-none [-webkit-touch-callout:none]',
              )}
              {...bind(id)}
            >
              <div className="flex items-start gap-3">
                {selection && selecting ? (
                  <div className="flex min-h-6 shrink-0 items-center pt-0.5">
                    <Checkbox
                      aria-label={`Pilih ${nameOf(row)}`}
                      checked={isSelected}
                      onCheckedChange={() => selection.toggle(id)}
                    />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1 space-y-1 break-words">
                  {titles.map(({ column }) => (
                    <div key={column.id} className="text-base">
                      {column.cell(row)}
                    </div>
                  ))}
                </div>
                {(actions || selection) && !selecting ? (
                  <div className="-mt-2.5 -mr-2 shrink-0">
                    <RowActions name={nameOf(row)} actions={rowActions} />
                  </div>
                ) : null}
              </div>
              {badgeEntries.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {badgeEntries.map(({ column, content }) => (
                    <span key={column.id}>{content}</span>
                  ))}
                </div>
              ) : null}
              {metaEntries.length > 0 ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {metaEntries.map(({ column, content }) => (
                    <div key={column.id} className="contents">
                      <dt className="text-muted-foreground">{column.header}</dt>
                      <dd className="min-w-0 break-words">{content}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
