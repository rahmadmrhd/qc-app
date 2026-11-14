import { useInfiniteQuery } from '@tanstack/react-query';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describeError } from '@/lib/api/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { buIdsWithLevelOf } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { type CaseSearch, caseFilterOfSearch, effectiveCaseStatus } from '../lib/case-filter';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL } from '../lib/labels';
import { serialCaseListQueryOptions } from '../queries';

export interface CaseListPageProps {
  search: CaseSearch;
  onSearchChange: (patch: Partial<CaseSearch>) => void;
  /** Buka detail serial pada tab laporan itu. */
  onOpen: (serialId: string, caseId: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Laporan aktif' },
  { value: 'closed', label: 'Laporan selesai' },
  { value: 'all', label: 'Semua laporan' },
];

function agoLabel(days: number): string {
  return days <= 0 ? 'Hari ini' : `${days} hari`;
}

const OUTCOME_LABEL = { good: 'Lolos', broken: 'Rusak' } as const;

/**
 * Daftar laporan rusak (bukan daftar serial): nomor LP, serial, item, BU, status, lama di status, pelapor, dan ringkasan.
 * Filter status (bawaan aktif) dan BU serta pencarian awalan nomor LP atau serial berada di URL; baris menuju detail
 * serial pada tab laporan itu. Tim servis (hanya `serialservice`) melihat semua laporan di BU-nya.
 */
export function CaseListPage({ search, onSearchChange, onOpen }: CaseListPageProps) {
  const me = useMe();
  const list = useInfiniteQuery(serialCaseListQueryOptions(caseFilterOfSearch(search)));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const readable = new Set([
    ...buIdsWithLevelOf(me, 'serial', 'view'),
    ...buIdsWithLevelOf(me, 'serialservice', 'view'),
  ]);
  const buOptions: LinkOption[] = (me.businessUnits ?? [])
    .filter((bu) => readable.has(bu.id))
    .map((bu) => ({ id: bu.id, label: `${bu.code} · ${bu.name}` }));
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) =>
    onSearchChange({ q: value.trim() === '' ? undefined : value.trim() }),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Laporan</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="case-search" className="text-xs text-muted-foreground">
            Cari nomor LP atau Serial Number
          </Label>
          <Input
            id="case-search"
            value={text}
            autoComplete="off"
            spellCheck={false}
            placeholder="Awalan nomor LP atau serial"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Select
          id="case-filter-status"
          label="Filter status laporan"
          hideLabel
          options={STATUS_OPTIONS}
          value={effectiveCaseStatus(search)}
          onValueChange={(next) =>
            onSearchChange({
              status: next === 'active' ? undefined : (next as CaseSearch['status']),
            })
          }
        />
        <LinkField
          id="case-filter-bu"
          label="Filter BU"
          hideLabel
          placeholder="Semua BU"
          localFilter
          value={search.bu ?? null}
          labelOf={(id) =>
            buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal'
          }
          options={buOptions}
          onChange={(id) => onSearchChange({ bu: id ?? undefined })}
        />
      </div>
      {list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat laporan: {describeError(list.error)}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nomor LP</TableHead>
              <TableHead>Serial Number</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>BU</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lokasi saat ini</TableHead>
              <TableHead>Lama</TableHead>
              <TableHead>Pelapor</TableHead>
              <TableHead>Ringkasan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-mono"
                    onClick={() => onOpen(entry.serialId, entry.id)}
                  >
                    {entry.number}
                  </Button>
                  <div className="text-xs text-muted-foreground">{formatDay(entry.openedOn)}</div>
                </TableCell>
                <TableCell className="font-mono">{entry.serial}</TableCell>
                <TableCell>{entry.itemLabel}</TableCell>
                <TableCell>{entry.buCode}</TableCell>
                <TableCell>
                  {entry.closedOn && entry.outcome ? (
                    <>
                      <Badge variant={entry.outcome === 'good' ? 'secondary' : 'destructive'}>
                        Hasil: {OUTCOME_LABEL[entry.outcome]}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        Selesai {formatDay(entry.closedOn)} · status sekarang{' '}
                        {STATUS_LABEL[entry.status]}
                      </div>
                    </>
                  ) : (
                    <Badge variant={entry.status === 'good' ? 'secondary' : 'destructive'}>
                      {STATUS_LABEL[entry.status]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {entry.locationName || '—'}
                  <div className="text-xs text-muted-foreground">
                    {CUSTODY_LABEL[entry.custody]}
                  </div>
                </TableCell>
                <TableCell>
                  {entry.closedOn
                    ? `Selesai dalam ${agoLabel(entry.durationDays)}`
                    : agoLabel(entry.daysInStatus)}
                </TableCell>
                <TableCell className="max-w-48 truncate" title={entry.reporter}>
                  {entry.reporter}
                </TableCell>
                <TableCell className="max-w-72 truncate" title={entry.summary}>
                  {entry.summary || '—'}
                </TableCell>
              </TableRow>
            ))}
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Memuat…
                </TableCell>
              </TableRow>
            ) : items.length === 0 && !list.isError ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Belum ada laporan di sini. Kalau ada unit bermasalah, laporkan lewat menu Lapor
                  Rusak.
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
