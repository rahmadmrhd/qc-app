import type { OpnameInput, StickerStockDto } from '@shared/contract';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OpnameDialog, type OpnameSaveResult } from './opname-dialog';
import {
  StockEntryDialog,
  type StockEntryMode,
  type StockSaveResult,
  type StockWrite,
} from './stock-entry-dialog';

export interface StockPageLocation {
  id: string;
  code: string;
  name: string;
}

export interface StockPageProps {
  rows: readonly StickerStockDto[];
  /** Lokasi yang sedang ditampilkan (terpilih dan boleh dilihat user). */
  locations: readonly StockPageLocation[];
  /** Catat masuk/keluar (`stickerstock: edit`). */
  canEdit: boolean;
  /** Koreksi dan stok opname (`stickerstock: manage`). */
  canManage: boolean;
  onWrite: (write: StockWrite) => Promise<StockSaveResult>;
  onOpname: (input: OpnameInput) => Promise<OpnameSaveResult>;
  onShowHistory: (row: StickerStockDto) => void;
}

/** Stok stiker untuk lokasi terpilih: total, rincian per lokasi, penanda "Menipis", catat/koreksi/opname, riwayat. */
export function StockPage({
  rows,
  locations,
  canEdit,
  canManage,
  onWrite,
  onOpname,
  onShowHistory,
}: StockPageProps) {
  const [entry, setEntry] = useState<{ mode: StockEntryMode; row: StickerStockDto } | null>(null);
  const [opnameOpen, setOpnameOpen] = useState(false);
  const codeById = new Map(locations.map((location) => [location.id, location.code]));
  const showBreakdown = locations.length > 1;
  const columns = 4 + (showBreakdown ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stok Stiker</h1>
        {canManage ? (
          <Button variant="outline" onClick={() => setOpnameOpen(true)}>
            Stok opname
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Jumlah butir per stiker di lokasi yang dipilih. "Menipis" dihitung dari total semua lokasi.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stiker</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {showBreakdown ? <TableHead>Per lokasi</TableHead> : null}
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} className="text-center text-muted-foreground">
                  Belum ada stiker.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.stickerId}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.low ? <Badge variant="destructive">Menipis</Badge> : null}
                    {row.status === 'inactive' ? <Badge variant="secondary">Nonaktif</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{row.typeName}</TableCell>
                <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                {showBreakdown ? (
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.byLocation.map((item) => (
                        <Badge key={item.locationId} variant="outline">
                          {`${codeById.get(item.locationId) ?? item.locationId} ${item.qty}`}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell className="space-x-2 text-right">
                  {canEdit && row.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Catat masuk ${row.name}`}
                      onClick={() => setEntry({ mode: 'in', row })}
                    >
                      Masuk
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Catat keluar ${row.name}`}
                      onClick={() => setEntry({ mode: 'out', row })}
                    >
                      Keluar
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Koreksi ${row.name}`}
                      onClick={() => setEntry({ mode: 'adjust', row })}
                    >
                      Koreksi
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Riwayat ${row.name}`}
                    onClick={() => onShowHistory(row)}
                  >
                    Riwayat
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <StockEntryDialog
        mode={entry?.mode ?? null}
        sticker={entry?.row ?? null}
        onOpenChange={(open) => (open ? undefined : setEntry(null))}
        onSave={onWrite}
      />
      <OpnameDialog open={opnameOpen} onOpenChange={setOpnameOpen} rows={rows} onSave={onOpname} />
    </div>
  );
}
