import { useInfiniteQuery } from '@tanstack/react-query';
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
import { describeError } from '@/lib/api/describe-error';
import { canUseSerialLocationOptions } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL } from '../lib/labels';
import { filterOfSearch, type SerialSearch } from '../lib/list-filter';
import { serialListQueryOptions } from '../queries';
import { SerialFilters } from './serial-filters';

export interface SerialListPageProps {
  search: SerialSearch;
  onSearchChange: (patch: Partial<SerialSearch>) => void;
  onOpen: (id: string) => void;
  /** Tombol "Catat serial" (hanya pengguna `serial: edit`). */
  onNew?: (() => void) | undefined;
}

/** Daftar serial berkursor dengan filter di URL; baris dibuka ke halaman detail. */
export function SerialListPage({ search, onSearchChange, onOpen, onNew }: SerialListPageProps) {
  const me = useMe();
  const list = useInfiniteQuery(serialListQueryOptions(filterOfSearch(search)));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Daftar Serial Number</h1>
        {onNew ? <Button onClick={onNew}>Catat Serial Number</Button> : null}
      </div>
      <NoLocationNotice relevant={!canUseSerialLocationOptions(me)} />
      <SerialFilters search={search} onChange={onSearchChange} />
      {list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat serial: {describeError(list.error)}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serial</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>BU</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>Tanggal uji</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Posisi</TableHead>
              <TableHead>Sample</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((serial) => (
              <TableRow key={serial.id}>
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-mono"
                    onClick={() => onOpen(serial.id)}
                  >
                    {serial.serial}
                  </Button>
                </TableCell>
                <TableCell>{serial.itemLabel}</TableCell>
                <TableCell>{serial.buCode}</TableCell>
                <TableCell>{serial.locationName}</TableCell>
                <TableCell>{formatDay(serial.testDate)}</TableCell>
                <TableCell>
                  <Badge variant={serial.status === 'good' ? 'secondary' : 'destructive'}>
                    {STATUS_LABEL[serial.status]}
                  </Badge>
                </TableCell>
                <TableCell>{CUSTODY_LABEL[serial.custody]}</TableCell>
                <TableCell>{serial.sample ? 'Ya' : '—'}</TableCell>
              </TableRow>
            ))}
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Memuat…
                </TableCell>
              </TableRow>
            ) : items.length === 0 && !list.isError ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Tidak ada serial yang cocok.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {list.hasNextPage ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
        </Button>
      ) : null}
    </div>
  );
}
