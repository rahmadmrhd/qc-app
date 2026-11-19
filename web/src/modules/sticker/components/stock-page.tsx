import type { OpnameInput, StickerStockDto } from '@shared/contract';
import { formatStockQty } from '@shared/stickers';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { STICKER_STATUS_LABEL } from '../lib/status';
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
  // Hanya mode dan id yang disimpan; barisnya diturunkan dari `rows` terbaru agar "Stok saat ini" di dialog ikut
  // diperbarui bila stok dimuat ulang saat dialog terbuka.
  const [entry, setEntry] = useState<{ mode: StockEntryMode; stickerId: string } | null>(null);
  const entryRow = entry ? (rows.find((row) => row.stickerId === entry.stickerId) ?? null) : null;
  // Baris hilang dari daftar saat dialog terbuka (mis. stiker nonaktif yang stoknya menjadi 0): tutup dengan bersih
  // dan beri tahu, alih-alih menghilang diam-diam atau terbuka sendiri lagi bila baris kembali.
  useEffect(() => {
    if (entry !== null && entryRow === null) {
      setEntry(null);
      toast.info('Stok stiker berubah; dialog ditutup');
    }
  }, [entry, entryRow]);
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
                    {row.low ? (
                      <Badge color="warning" variant="soft" dot>
                        Menipis
                      </Badge>
                    ) : null}
                    {row.status === 'active' ? null : (
                      <Badge variant="secondary">{STICKER_STATUS_LABEL[row.status]}</Badge>
                    )}
                    {row.typeStatus === 'inactive' ? (
                      <Badge color="secondary" variant="soft" dot>
                        Jenis nonaktif
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{row.typeName}</TableCell>
                <TableCell
                  className={`text-right tabular-nums${row.total < 0 ? ' text-destructive-text' : ''}`}
                >
                  {formatStockQty(row.total)}
                </TableCell>
                {showBreakdown ? (
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.byLocation.map((item) => (
                        <Badge key={item.locationId} variant="outline">
                          {`${codeById.get(item.locationId) ?? item.locationId} ${formatStockQty(item.qty)}`}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell className="space-x-2 text-right">
                  {canEdit && row.status === 'active' && row.typeStatus === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Catat masuk ${row.name}`}
                      onClick={() => setEntry({ mode: 'in', stickerId: row.stickerId })}
                    >
                      Masuk
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Catat keluar ${row.name}`}
                      onClick={() => setEntry({ mode: 'out', stickerId: row.stickerId })}
                    >
                      Keluar
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Koreksi ${row.name}`}
                      onClick={() => setEntry({ mode: 'adjust', stickerId: row.stickerId })}
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
        sticker={entryRow}
        onOpenChange={(open) => (open ? undefined : setEntry(null))}
        onSave={onWrite}
      />
      <OpnameDialog open={opnameOpen} onOpenChange={setOpnameOpen} rows={rows} onSave={onOpname} />
    </div>
  );
}
