import { assignmentKey } from '@shared/assignments';
import { ALL_BU_KEY } from '@shared/business-units';
import type { UserDto } from '@shared/contract';
import { ActiveStatusBadge } from '@/components/status-badge';
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

export interface UsersTableProps {
  users: readonly UserDto[];
  roleNames: ReadonlyMap<string, string>;
  locationNames: ReadonlyMap<string, string>;
  businessUnitNames: ReadonlyMap<string, string>;
  canManage: boolean;
  currentEmail: string;
  pendingStatusId: string | null;
  onEdit: (user: UserDto) => void;
  onToggleStatus: (user: UserDto) => void;
}

export function UsersTable({
  users,
  roleNames,
  locationNames,
  businessUnitNames,
  canManage,
  currentEmail,
  pendingStatusId,
  onEdit,
  onToggleStatus,
}: UsersTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Penugasan</TableHead>
            <TableHead>Penugasan BU</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground">
                Tidak ada user yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {users.map((user) => {
            const isSelf = user.email === currentEmail;
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{user.name}</span>
                    {user.sharedAccount ? <Badge variant="outline">Akun bersama</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.assignments.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                    {user.assignments.map((entry) => (
                      <Badge key={assignmentKey(entry.locationId)} variant="outline">
                        {`${
                          entry.locationId === null
                            ? 'Semua lokasi'
                            : (locationNames.get(entry.locationId) ?? '(lokasi tidak dikenal)')
                        }: ${entry.roleIds.map((id) => roleNames.get(id) ?? '(role dihapus)').join(', ')}`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.buAssignments.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                    {user.buAssignments.map((entry) => (
                      <Badge key={entry.buId ?? ALL_BU_KEY} variant="outline">
                        {`${
                          entry.buId === null
                            ? 'Semua BU'
                            : (businessUnitNames.get(entry.buId) ?? '(BU tidak dikenal)')
                        }: ${entry.roleIds.map((id) => roleNames.get(id) ?? '(role dihapus)').join(', ')}`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <ActiveStatusBadge status={user.status} />
                </TableCell>
                {canManage ? (
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingStatusId === user.id || (isSelf && user.status === 'active')}
                      onClick={() => onToggleStatus(user)}
                    >
                      {user.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
