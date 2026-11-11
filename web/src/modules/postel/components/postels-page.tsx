import type { PostelListDto } from '@shared/contract';
import { comparePostels, filterPostels, type PostelConditionFilter } from '@shared/postel';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { daysLeftLabel, formatPostelDate } from '../lib/condition';
import { PostelConditionBadge } from './postel-condition-badge';

export interface PostelsPageProps {
  data: PostelListDto;
  canEdit: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  /**
   * Tautan halaman catatan (`postelLinkAccess`): bila ada, nama menjadi tautan sungguhan (dapat dibuka di tab baru);
   * klik biasa tetap memakai `onOpen` (navigasi router tanpa memuat ulang halaman).
   */
  openHref?: ((id: string) => string | null) | undefined;
}

const CONDITION_FILTER_OPTIONS: { value: PostelConditionFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'soon', label: 'Segera habis' },
  { value: 'expired', label: 'Kedaluwarsa' },
];

const COLUMN_COUNT = 8;

/**
 * Daftar catatan Postel (tanpa paginasi: server memberi semua catatan). Kondisi sebuah catatan = kondisi nomor
 * Aktif-nya. Pencarian menyaring nama, semua nomor (Aktif dan Lama), atau model item (`filterPostels`); urut bawaan tanggal habis nomor Aktif menaik.
 */
export function PostelsPage({ data, canEdit, onNew, onOpen, openHref }: PostelsPageProps) {
  const [search, setSearch] = useState('');
  const [condition, setCondition] = useState<PostelConditionFilter>('all');
  const visible = filterPostels([...data.postels].sort(comparePostels), {
    query: search,
    condition,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Postel</h1>
        {canEdit ? <Button onClick={onNew}>Tambah Postel</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Catatan sertifikat Postel beserta masa berlakunya. Kondisi catatan mengikuti nomor Aktif
        (nomor terbaru).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Cari Postel"
            placeholder="Cari nama, nomor, atau model"
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          id="postel-filter-condition"
          label="Filter kondisi"
          hideLabel
          className="sm:w-48"
          options={CONDITION_FILTER_OPTIONS}
          value={condition}
          onValueChange={(next) => setCondition(next as PostelConditionFilter)}
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead className="text-right">Jumlah item</TableHead>
              <TableHead>Nomor Aktif</TableHead>
              <TableHead>Tanggal habis</TableHead>
              <TableHead>Sisa hari</TableHead>
              <TableHead>Kondisi</TableHead>
              <TableHead className="text-right">Nomor lama</TableHead>
              <TableHead>Diperbarui</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="text-center text-muted-foreground">
                  {data.postels.length === 0
                    ? 'Belum ada catatan Postel.'
                    : 'Tidak ada Postel yang cocok.'}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((postel) => (
              <TableRow key={postel.id}>
                <TableCell className="font-medium">
                  {(() => {
                    const href = openHref?.(postel.id) ?? null;
                    return href ? (
                      <a
                        href={href}
                        className="underline-offset-2 hover:underline"
                        onClick={(event) => {
                          // Klik modifikasi (tab baru, jendela baru) dibiarkan ke peramban.
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                            return;
                          event.preventDefault();
                          onOpen(postel.id);
                        }}
                      >
                        {postel.name}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => onOpen(postel.id)}
                      >
                        {postel.name}
                      </button>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">{postel.itemCount}</TableCell>
                <TableCell>{postel.activeNumber}</TableCell>
                <TableCell>{formatPostelDate(postel.activeExpiresOn)}</TableCell>
                <TableCell>{daysLeftLabel(postel.daysLeft)}</TableCell>
                <TableCell>
                  <PostelConditionBadge condition={postel.condition} />
                </TableCell>
                <TableCell className="text-right">{postel.oldNumberCount}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatAuditTime(postel.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
