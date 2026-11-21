import type { StickerStockDto, StockEntryDto } from '@shared/contract';
import type { StockCount, StockEntryKind } from '@shared/stickers';
import { formatStockQty } from '@shared/stickers';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MobileCard } from '@/components/mobile/mobile-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { describeError } from '@/lib/api/describe-error';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { stockHistoryQuery } from '../queries';

const KIND_LABEL: Record<StockEntryKind, string> = {
  in: 'Masuk',
  out: 'Keluar',
  adjust: 'Koreksi',
  opname: 'Opname',
  serial: 'Dipotong Serial Number',
};

/** "10 × 12 + 3 × 10 + 5 butir"; kosong bila entri tidak memakai hitungan lembar. */
function describeCount(count: StockCount | null): string {
  if (!count) return '';
  const parts = count.rows.map((row) => `${row.sheets} × ${row.perSheet}`);
  if (count.loose > 0) parts.push(`${count.loose} butir`);
  return parts.join(' + ');
}

const signed = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

export interface StockHistoryProps {
  entries: readonly StockEntryDto[];
  locationNames: ReadonlyMap<string, string>;
  /** Kolom Lokasi hanya bila riwayat mencakup lebih dari satu lokasi. */
  showLocation: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Satu entri riwayat sebagai kartu ponsel (`MobileCard`): jenis entri sebagai judul dan waktu sebagai subjudul, lalu
 * meta berlabel (perubahan, stok sesudah, lokasi, oleh, alasan). Stok sesudah negatif diberi lencana "Kurang".
 */
function StockHistoryCard({
  entry,
  locationName,
  showLocation,
}: {
  entry: StockEntryDto;
  locationName: string;
  showLocation: boolean;
}) {
  const counted = describeCount(entry.count);
  return (
    <MobileCard
      title={KIND_LABEL[entry.kind]}
      subtitle={formatAuditTime(entry.ts)}
      badges={
        entry.qtyAfter < 0
          ? [
              <Badge key="short" variant="soft" color="destructive">
                Stok kurang
              </Badge>,
            ]
          : []
      }
      meta={[
        {
          id: 'delta',
          label: 'Perubahan',
          value: <span className="tabular-nums">{signed(entry.delta)}</span>,
        },
        {
          id: 'after',
          label: 'Stok sesudah',
          value: (
            <span className={`tabular-nums${entry.qtyAfter < 0 ? ' text-destructive-text' : ''}`}>
              {formatStockQty(entry.qtyAfter)}
            </span>
          ),
        },
        ...(showLocation ? [{ id: 'location', label: 'Lokasi', value: locationName }] : []),
        { id: 'actor', label: 'Oleh', value: entry.actor },
        ...(entry.reason !== '' || counted !== ''
          ? [
              {
                id: 'reason',
                label: 'Alasan',
                value: (
                  <>
                    {entry.reason !== '' ? <div>{entry.reason}</div> : null}
                    {counted !== '' ? (
                      <div className="text-xs text-muted-foreground">{counted}</div>
                    ) : null}
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * Riwayat stok satu stiker (terbaru lebih dulu), berhalaman kursor server. Di < 768 px berbentuk daftar kartu
 * (konsisten dengan daftar lain di ponsel); >= 768 px tabel.
 */
export function StockHistory({
  entries,
  locationNames,
  showLocation,
  hasMore,
  loadingMore,
  onLoadMore,
}: StockHistoryProps) {
  const isMobile = useIsMobile();
  return (
    <div className="space-y-3">
      {isMobile ? (
        entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Belum ada riwayat.</p>
        ) : (
          <ul className="space-y-2" data-slot="stock-history-cards">
            {entries.map((entry) => (
              <StockHistoryCard
                key={entry.id}
                entry={entry}
                locationName={locationNames.get(entry.locationId) ?? entry.locationId}
                showLocation={showLocation}
              />
            ))}
          </ul>
        )
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Jenis</TableHead>
                {showLocation ? <TableHead>Lokasi</TableHead> : null}
                <TableHead className="text-right">Perubahan</TableHead>
                <TableHead className="text-right">Stok sesudah</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showLocation ? 7 : 6}
                    className="text-center text-muted-foreground"
                  >
                    Belum ada riwayat.
                  </TableCell>
                </TableRow>
              ) : null}
              {entries.map((entry) => {
                const counted = describeCount(entry.count);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatAuditTime(entry.ts)}</TableCell>
                    <TableCell>{KIND_LABEL[entry.kind]}</TableCell>
                    {showLocation ? (
                      <TableCell>
                        {locationNames.get(entry.locationId) ?? entry.locationId}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">{signed(entry.delta)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums${entry.qtyAfter < 0 ? ' text-destructive-text' : ''}`}
                    >
                      {formatStockQty(entry.qtyAfter)}
                    </TableCell>
                    <TableCell>
                      {entry.reason !== '' ? <div>{entry.reason}</div> : null}
                      {counted !== '' ? (
                        <div className="text-xs text-muted-foreground">{counted}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{entry.actor}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" color="primary" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface StockHistoryDialogProps {
  /** Stiker yang riwayatnya dibuka; `null` = dialog tertutup. */
  sticker: Pick<StickerStockDto, 'stickerId' | 'name'> | null;
  locationIds: readonly string[];
  locationNames: ReadonlyMap<string, string>;
  onClose: () => void;
}

/** Riwayat satu stiker yang memuat sendiri (kursor server); dipakai dialog dan tab Riwayat View Stiker. */
export function StockHistoryPanel({
  stickerId,
  locationIds,
  locationNames,
}: {
  stickerId: string;
  locationIds: readonly string[];
  locationNames: ReadonlyMap<string, string>;
}) {
  const query = useInfiniteQuery(stockHistoryQuery(stickerId, locationIds));
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat riwayat…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(query.error)}
      </p>
    );
  }
  return (
    <StockHistory
      entries={query.data.pages.flatMap((page) => page.entries)}
      locationNames={locationNames}
      showLocation={locationIds.length > 1}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}

/** Dialog riwayat stok per stiker untuk lokasi yang sedang tampil. */
export function StockHistoryDialog({
  sticker,
  locationIds,
  locationNames,
  onClose,
}: StockHistoryDialogProps) {
  return (
    <Dialog open={sticker !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="full-on-phone" className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{sticker ? `Riwayat ${sticker.name}` : 'Riwayat stok'}</DialogTitle>
          <DialogDescription>
            Perubahan stok pada lokasi yang sedang dipilih, terbaru di atas.
          </DialogDescription>
        </DialogHeader>
        {sticker ? (
          <StockHistoryPanel
            key={sticker.stickerId}
            stickerId={sticker.stickerId}
            locationIds={locationIds}
            locationNames={locationNames}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
