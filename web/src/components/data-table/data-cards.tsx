import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { MobileCard } from '@/components/mobile/mobile-card';
import { useRegisterSelectMode } from '@/components/page/select-mode';
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
  /** Kartu yang tidak boleh dipilih: tanpa tekan lama, checkbox, dan "Pilih" di menu (bawaan: semua boleh). */
  isSelectable?: ((row: T) => boolean) | undefined;
  actions?: ((row: T) => readonly RowAction[]) | undefined;
  isLoading?: boolean | undefined;
  /** Klik badan kartu membuka detail (B9); `undefined` untuk baris itu = kartu tak dapat diklik. Nonaktif saat mode pilih. */
  openOf?: ((row: T) => (() => void) | undefined) | undefined;
}

/**
 * Tampilan kartu bertumpuk `DataTable` di < 768 px: judul (tautan), menu "⋯" berlabel di kanan atas, lencana status
 * di bawah judul, lalu pasangan label–nilai dari kolom `meta`. Pilih massal: tekan lama kartu (`useLongPressSelect`) atau
 * "Pilih" di menu "⋯"; mode pilih menampilkan checkbox dan mendaftarkan diri ke bar aksi bawah (`BulkBar`; tanpa halaman
 * berkerangka kit, `SelectionBar` di atas daftar sebagai cadangan); kartu terpilih ditandai `data-state`.
 */
export function DataCards<T>({
  rows,
  rowKey,
  columns,
  label,
  nameOf,
  selection,
  isSelectable,
  actions,
  isLoading,
  openOf,
}: DataCardsProps<T>) {
  const roles = resolveMobileRoles(columns);
  const { selecting, bind, exit } = useLongPressSelect(selection, true);
  const ids = rows.filter((row) => isSelectable?.(row) ?? true).map(rowKey);
  const allSelected = ids.length > 0 && ids.every((id) => selection?.selected.has(id));
  // Mode pilih = SATU bar bawah (`BulkBar`) bila halaman menampungnya; header pilihan di atas hanya cadangan.
  const hosted = useRegisterSelectMode(selecting, {
    count: selection?.count ?? 0,
    allSelected,
    exit,
    toggleAll: () => selection?.setAll(ids, !allSelected),
  });
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
      {selection && selecting && !hosted ? (
        <SelectionBar selection={selection} ids={ids} onExit={exit} />
      ) : null}
      {selection && !selecting && rows.length > 0 ? <LongPressHint /> : null}
      <ul aria-label={label} className="space-y-2">
        {rows.map((row) => {
          const id = rowKey(row);
          const isSelected = selection?.selected.has(id) ?? false;
          const baseActions = actions?.(row) ?? [];
          const selectable = isSelectable?.(row) ?? true;
          // Jalur cadangan non-sentuh: "Pilih" di menu ⋯ masuk mode pilih dengan kartu ini terpilih.
          const rowActions: readonly RowAction[] =
            selection && selectable
              ? [
                  ...baseActions,
                  {
                    id: 'select',
                    action: 'select',
                    label: `Pilih ${nameOf(row)}`,
                    shortLabel: 'Pilih',
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
            <MobileCard
              key={id}
              selected={isSelected}
              {...(!selecting && openOf?.(row) ? { onOpen: openOf(row) } : {})}
              rootProps={{
                className:
                  selection && selectable
                    ? `${selecting ? 'select-none ' : ''}[-webkit-touch-callout:none] data-[pressing]:select-none`
                    : undefined,
                ...(selectable ? bind(id) : {}),
              }}
              leading={
                selection && selecting && selectable ? (
                  <Checkbox
                    aria-label={`Pilih ${nameOf(row)}`}
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(id)}
                  />
                ) : undefined
              }
              title={titles.map(({ column }) => <div key={column.id}>{column.cell(row)}</div>)}
              actions={
                (actions || selection) && !selecting ? (
                  <RowActions name={nameOf(row)} actions={rowActions} />
                ) : undefined
              }
              badges={badgeEntries.map(({ column, content }) => (
                <Fragment key={column.id}>{content}</Fragment>
              ))}
              meta={metaEntries.map(({ column, content }) => ({
                id: column.id,
                label: column.header,
                value: content,
              }))}
            />
          );
        })}
      </ul>
    </div>
  );
}
