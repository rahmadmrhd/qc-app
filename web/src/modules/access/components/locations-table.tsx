import type { LocationDto } from '@shared/rpc';
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

export interface LocationsTableProps {
  locations: readonly LocationDto[];
  canManage: boolean;
  pendingStatusId: string | null;
  onEdit: (location: LocationDto) => void;
  onToggleStatus: (location: LocationDto) => void;
}

export function LocationsTable({
  locations,
  canManage,
  pendingStatusId,
  onEdit,
  onToggleStatus,
}: LocationsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kode</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                Belum ada lokasi.
              </TableCell>
            </TableRow>
          ) : null}
          {locations.map((location) => (
            <TableRow key={location.id}>
              <TableCell className="font-medium">{location.code}</TableCell>
              <TableCell>{location.name}</TableCell>
              <TableCell>
                <Badge variant={location.status === 'active' ? 'default' : 'secondary'}>
                  {location.status === 'active' ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              {canManage ? (
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(location)}>
                    Ubah
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingStatusId === location.id}
                    onClick={() => onToggleStatus(location)}
                  >
                    {location.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
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
