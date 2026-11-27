import { type DataColumn, DataTable, type RowSelection } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { formatDay } from '@/modules/serial/lib/labels';

/** Satu serial di stok, sudah diratakan dari kardusnya (urutan = urutan tampil). */
export interface ReadyRow {
  id: string;
  serial: string;
  boxId: string;
  boxNumber: number;
  capacity: number;
  remaining: number;
  recordedOn: string;
  processing: boolean;
  /** Nada selang-seling per kardus. */
  tone: 'a' | 'b';
  firstOfBox: boolean;
  itemLabel: string;
}

/** Tipe dan BU serial (dari `serialWarehouse.lookup`); kosong bila belum termuat atau tak boleh dibaca. */
export interface ReadyRowInfo {
  itemLabel: string;
  buCode: string;
}

export interface ReadyStockTableProps {
  label: string;
  rows: readonly ReadyRow[];
  info: ReadonlyMap<string, ReadyRowInfo>;
  /** Pilihan bersama (hanya bagian yang tampil di tabel ini). */
  selection: RowSelection;
  /** Memilih atau melepas semua serial yang bisa dipilih pada satu kardus. */
  onToggleBox: (boxId: string, on: boolean) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty?: string;
  filtered?: boolean;
  onClearFilters?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
}

/** Satu bagian tabel Stok Ready (Kardus penuh atau Ecer): baris per serial, diwarnai selang-seling per kardus. */
export function ReadyStockTable({
  label,
  rows,
  info,
  selection,
  onToggleBox,
  ...rest
}: ReadyStockTableProps) {
  const desktop = useIsDesktop();
  const boxState = (boxId: string): boolean | 'indeterminate' => {
    const selectable = rows.filter((row) => row.boxId === boxId && !row.processing);
    const chosen = selectable.filter((row) => selection.selected.has(row.id)).length;
    if (chosen === 0) return false;
    return chosen === selectable.length ? true : 'indeterminate';
  };
  const boxSelectable = (boxId: string) =>
    rows.some((row) => row.boxId === boxId && !row.processing);

  const columns: DataColumn<ReadyRow>[] = [
    {
      id: 'box',
      header: 'Kardus',
      mobile: 'meta',
      cell: (row) => (
        <div className="flex items-center gap-2">
          {desktop ? (
            row.firstOfBox && boxSelectable(row.boxId) ? (
              <Checkbox
                aria-label={`Pilih kardus ${row.boxNumber}`}
                checked={boxState(row.boxId)}
                onCheckedChange={() => onToggleBox(row.boxId, boxState(row.boxId) !== true)}
              />
            ) : (
              <span className="inline-block size-4" aria-hidden="true" />
            )
          ) : null}
          <span className="font-medium">{row.boxNumber}</span>
          <span className="text-xs text-muted-foreground">
            {row.remaining}/{row.capacity}
          </span>
        </div>
      ),
    },
    {
      id: 'item',
      header: 'Tipe',
      mobile: 'meta',
      cell: (row) => row.itemLabel || info.get(row.id)?.itemLabel || '—',
    },
    {
      id: 'serial',
      header: 'Serial Number',
      mobile: 'title',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{row.serial}</span>
          {row.processing ? (
            <Badge variant="soft" color="warning">
              Sedang diproses
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'bu', header: 'BU', mobile: 'meta', cell: (row) => info.get(row.id)?.buCode || '—' },
    {
      id: 'recorded',
      header: 'Dicatat',
      mobile: 'meta',
      cell: (row) => formatDay(row.recordedOn),
    },
  ];

  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      label={label}
      selectLabel={(row) => row.serial}
      selection={selection}
      rowSelectable={(row) => !row.processing}
      rowTone={(row) => row.tone}
      fit="content"
      {...rest}
    />
  );
}
