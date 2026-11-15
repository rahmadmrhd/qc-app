import type { PushUserState, PushUserStatusDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageLoading } from '@/components/page-loading';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  countPushStates,
  filterPushStatuses,
  PUSH_STATE_LABELS,
  PUSH_STATE_ORDER,
  sortPushStatuses,
} from '../lib/status';
import { pushStatusQueryOptions } from '../queries';

const BADGE_VARIANT: Record<PushUserState, 'secondary' | 'outline' | 'destructive'> = {
  denied: 'destructive',
  failing: 'destructive',
  none: 'outline',
  disabled: 'outline',
  active: 'secondary',
};

export function PushStatusTable({ rows }: { rows: readonly PushUserStatusDto[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status push</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                Tidak ada pengguna yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row) => (
            <TableRow key={row.email}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>
                <Badge variant={BADGE_VARIANT[row.state]}>{PUSH_STATE_LABELS[row.state]}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Status notifikasi push per pengguna untuk admin (spek §5.2, §10): dihitung server dari hasil pengiriman nyata.
 * Hanya status per pengguna; tanpa pengenal perangkat atau rincian galat.
 */
export function PushStatusPage() {
  const query = useQuery(pushStatusQueryOptions());
  const [text, setText] = useState('');
  const rows = query.data;
  const counts = rows ? countPushStates(rows) : null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Status Push</h1>
      <p className="text-sm text-muted-foreground">
        Pengguna yang bermasalah tampil paling atas. Lonceng di aplikasi tetap menerima semua
        notifikasi apa pun status push-nya.
      </p>
      {counts ? (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Ringkasan status">
          {PUSH_STATE_ORDER.map((state) => (
            <li key={state}>
              <Badge variant={BADGE_VARIANT[state]}>
                {PUSH_STATE_LABELS[state]}: {counts[state]}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        placeholder="Cari nama atau email"
        aria-label="Cari nama atau email"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {rows ? (
        <PushStatusTable rows={sortPushStatuses(filterPushStatuses(rows, text))} />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Status push gagal dimuat.
        </p>
      ) : (
        <PageLoading label="Memuat status push…" />
      )}
    </div>
  );
}
