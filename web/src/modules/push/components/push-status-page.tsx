import type { PushUserState, PushUserStatusDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { FilterBar } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Badge } from '@/components/ui/badge';
import { usersQueryOptions } from '@/modules/access/queries';
import {
  countPushStates,
  filterPushStatuses,
  PUSH_STATE_LABELS,
  PUSH_STATE_ORDER,
  sortPushStatuses,
} from '../lib/status';
import { pushStatusQueryOptions } from '../queries';

const BADGE_COLOR: Record<PushUserState, 'destructive' | 'secondary' | 'success'> = {
  denied: 'destructive',
  failing: 'destructive',
  none: 'secondary',
  disabled: 'secondary',
  active: 'success',
};

export function PushStateBadge({ state }: { state: PushUserState }) {
  return (
    <Badge color={BADGE_COLOR[state]} variant="soft" dot>
      {PUSH_STATE_LABELS[state]}
    </Badge>
  );
}

export interface PushStatusTableProps {
  rows: readonly PushUserStatusDto[];
  /** Email (huruf kecil) -> id pengguna untuk tautan nama ke View pengguna; email tanpa padanan tampil sebagai teks. */
  userIds?: ReadonlyMap<string, string>;
  filtered?: boolean;
  onClearFilters?: () => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Tabel status push (kit): nama (tautan ke View pengguna) | email | status. Di ponsel menjadi kartu. */
export function PushStatusTable({
  rows,
  userIds,
  filtered,
  onClearFilters,
  isLoading,
  isError,
  onRetry,
}: PushStatusTableProps) {
  const columns: DataColumn<PushUserStatusDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (row) => {
        const userId = userIds?.get(row.email.toLowerCase());
        return userId ? (
          <LinkCell to="/access/users/$userId" params={{ userId }}>
            {row.name}
          </LinkCell>
        ) : (
          row.name
        );
      },
    },
    { id: 'email', header: 'Email', cell: (row) => row.email },
    {
      id: 'status',
      header: 'Status push',
      mobile: 'badge',
      cell: (row) => <PushStateBadge state={row.state} />,
    },
  ];
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.email}
      columns={columns}
      label="Status push pengguna"
      empty="Belum ada pengguna."
      filtered={filtered}
      onClearFilters={onClearFilters}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}

/**
 * Status notifikasi push per pengguna untuk admin (spek §5.2, §10): dihitung server dari hasil pengiriman nyata.
 * Hanya status per pengguna; tanpa pengenal perangkat atau rincian galat. Teks pencarian dipegang rute (search param).
 */
export function PushStatusPage({
  text,
  onTextChange,
}: {
  text: string;
  onTextChange: (value: string) => void;
}) {
  const query = useQuery(pushStatusQueryOptions());
  const users = useQuery(usersQueryOptions());
  const rows = query.data;
  const counts = rows ? countPushStates(rows) : null;
  const userIds = new Map((users.data ?? []).map((user) => [user.email.toLowerCase(), user.id]));
  const visible = rows ? sortPushStatuses(filterPushStatuses(rows, text)) : [];
  const filtered = text.trim() !== '';
  return (
    <ListPage
      title="Status Push"
      count={rows ? `${visible.length} pengguna` : undefined}
      filters={
        <FilterBar
          search={{
            value: text,
            onChange: onTextChange,
            placeholder: 'Cari nama atau email',
            label: 'Cari nama atau email',
          }}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pengguna yang bermasalah tampil paling atas. Lonceng di aplikasi tetap menerima semua
          notifikasi apa pun status push-nya.
        </p>
        {counts ? (
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Ringkasan status">
            {PUSH_STATE_ORDER.map((state) => (
              <li key={state}>
                <Badge color={BADGE_COLOR[state]} variant="soft">
                  {PUSH_STATE_LABELS[state]}: {counts[state]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <PushStatusTable
          rows={visible}
          userIds={userIds}
          filtered={filtered}
          onClearFilters={() => onTextChange('')}
          isLoading={query.isPending}
          isError={query.isError}
          onRetry={() => void query.refetch()}
        />
      </div>
    </ListPage>
  );
}
