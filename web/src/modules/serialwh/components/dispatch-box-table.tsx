import type { WarehouseDispatchSerialDto } from '@shared/contract';
import { type DataColumn, DataTable, type RowSelection } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';

/** Satu serial pencatatan Ready dengan nada selang-seling per kardus (menurut urutan tampil = urutan `seq`). */
export interface BoxSerialRow extends WarehouseDispatchSerialDto {
  tone: 'a' | 'b';
  boxStart: boolean;
}

/** Kardus pada urutan `seq` sudah berurutan (penuh dulu, ecer terakhir): nada berganti tiap id kardus berganti. */
export function toBoxRows(rows: readonly WarehouseDispatchSerialDto[]): BoxSerialRow[] {
  let tone: 'a' | 'b' = 'a';
  let previous: string | undefined;
  return rows.map((row) => {
    const boxStart = previous !== undefined && row.boxId !== previous;
    if (boxStart) tone = tone === 'a' ? 'b' : 'a';
    previous = row.boxId;
    return { ...row, tone, boxStart };
  });
}

/** Pencatatan ready memuat info kardus pada baris serialnya. */
export function hasBoxes(rows: readonly WarehouseDispatchSerialDto[]): boolean {
  return rows.some((row) => row.boxId !== undefined);
}

export function SerialFlags({ row }: { row: WarehouseDispatchSerialDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {row.createdNew ? (
        <Badge variant="soft" color="info">
          Dibuat saat keluar
        </Badge>
      ) : null}
      {row.deleted ? (
        <Badge variant="soft" color="destructive">
          Terhapus
        </Badge>
      ) : null}
    </span>
  );
}

const COLUMNS: DataColumn<BoxSerialRow>[] = [
  {
    id: 'box',
    header: 'Kardus',
    mobile: 'meta',
    cell: (row) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.boxNumber ?? '—'}</span>
        {row.boxCount !== undefined && row.capacity !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {row.boxCount}/{row.capacity}
          </span>
        ) : null}
      </div>
    ),
  },
  { id: 'seq', header: 'No', mobile: 'meta', cell: (row) => row.seq + 1 },
  {
    id: 'serial',
    header: 'Serial Number',
    mobile: 'title',
    cell: (row) => <span className="font-mono">{row.serial}</span>,
  },
  {
    id: 'flags',
    header: 'Keterangan',
    mobile: 'badge',
    cell: (row) => <SerialFlags row={row} />,
  },
];

export interface DispatchBoxTableProps {
  rows: readonly WarehouseDispatchSerialDto[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: boolean;
  onLoadMore?: () => void;
  /** Pilihan baris (untuk "Salin terpilih"); tanpa ini tabel tanpa kotak centang. */
  selection?: RowSelection;
}

/**
 * Serial satu pencatatan Ready per kardus: baris per serial, diwarnai selang-seling per kardus, kolom Kardus memuat
 * "isi/kapasitas" (kardus penuh lebih dulu, ecer terakhir mengikuti urutan `seq`).
 */
export function DispatchBoxTable({ rows, ...rest }: DispatchBoxTableProps) {
  return (
    <DataTable
      rows={toBoxRows(rows)}
      rowKey={(row) => `${row.seq}`}
      columns={COLUMNS}
      label="Serial Number pencatatan per kardus"
      rowTone={(row) => row.tone}
      rowClassName={(row) =>
        row.boxStart
          ? '[&_td]:border-b-foreground/20 [&_td]:border-t-2 [&_td]:border-t-foreground/30'
          : '[&_td]:border-b-foreground/20'
      }
      selectLabel={(row) => row.serial}
      fit="content"
      empty="Belum ada Serial Number."
      {...rest}
    />
  );
}
