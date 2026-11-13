import type { RoleDto } from '@shared/contract';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionBadges } from './permission-badges';

export interface RolesTableProps {
  roles: readonly RoleDto[];
  canManage: boolean;
  onEdit: (role: RoleDto) => void;
  onDelete: (role: RoleDto) => void;
}

export function RolesTable({ roles, canManage, onEdit, onDelete }: RolesTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Akses</TableHead>
            <TableHead className="text-right">User</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                Belum ada role.
              </TableCell>
            </TableRow>
          ) : null}
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell>
                <div className="font-medium">{role.name}</div>
                {role.description ? (
                  <div className="text-sm text-muted-foreground">{role.description}</div>
                ) : null}
              </TableCell>
              <TableCell>
                <PermissionBadges permissions={role.permissions} />
              </TableCell>
              <TableCell className="text-right">{role.userCount}</TableCell>
              {canManage ? (
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(role)}>
                    Ubah
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={role.userCount > 0}
                    onClick={() => onDelete(role)}
                  >
                    Hapus
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
