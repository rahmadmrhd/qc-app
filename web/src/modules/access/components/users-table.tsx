import type { UserDto } from '@shared/rpc';
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
  canManage: boolean;
  currentEmail: string;
  pendingStatusId: string | null;
  onEdit: (user: UserDto) => void;
  onToggleStatus: (user: UserDto) => void;
}

export function UsersTable({
  users,
  roleNames,
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
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground">
                Tidak ada user yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {users.map((user) => {
            const isSelf = user.email === currentEmail;
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{user.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.roleIds.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                    {user.roleIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {roleNames.get(id) ?? '(role dihapus)'}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                    {user.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
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
