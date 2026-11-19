import type { BusinessUnitDto } from '@shared/contract';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

export interface BusinessUnitsTableProps {
  businessUnits: readonly BusinessUnitDto[];
  canManage: boolean;
  pendingStatusId: string | null;
  onEdit: (businessUnit: BusinessUnitDto) => void;
  onToggleStatus: (businessUnit: BusinessUnitDto) => void;
}

/** BU yang masih dipakai tetap boleh dinonaktifkan, tetapi pemegang akses diberi tahu dampaknya lebih dulu. */
function needsConfirmation(businessUnit: BusinessUnitDto): boolean {
  return (
    businessUnit.status === 'active' && (businessUnit.itemCount > 0 || businessUnit.userCount > 0)
  );
}

export function BusinessUnitsTable({
  businessUnits,
  canManage,
  pendingStatusId,
  onEdit,
  onToggleStatus,
}: BusinessUnitsTableProps) {
  const [confirming, setConfirming] = useState<BusinessUnitDto | null>(null);

  function handleToggle(businessUnit: BusinessUnitDto) {
    if (needsConfirmation(businessUnit)) setConfirming(businessUnit);
    else onToggleStatus(businessUnit);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kode</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Item</TableHead>
            <TableHead className="text-right">User</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {businessUnits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground">
                Belum ada Business Unit.
              </TableCell>
            </TableRow>
          ) : null}
          {businessUnits.map((businessUnit) => (
            <TableRow key={businessUnit.id}>
              <TableCell className="font-medium">{businessUnit.code}</TableCell>
              <TableCell>{businessUnit.name}</TableCell>
              <TableCell>
                <Badge
                  color={businessUnit.status === 'active' ? 'success' : 'secondary'}
                  variant="soft"
                  dot
                >
                  {businessUnit.status === 'active' ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{businessUnit.itemCount}</TableCell>
              <TableCell className="text-right tabular-nums">{businessUnit.userCount}</TableCell>
              {canManage ? (
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(businessUnit)}>
                    Ubah
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingStatusId === businessUnit.id}
                    onClick={() => handleToggle(businessUnit)}
                  >
                    {businessUnit.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nonaktifkan BU {confirming?.name}?</DialogTitle>
            <DialogDescription>
              BU ini masih dipakai oleh {confirming?.itemCount ?? 0} item dan{' '}
              {confirming?.userCount ?? 0} user aktif. Item dan hak yang sudah ada tetap berlaku,
              tetapi BU ini tidak dapat ditambahkan ke data baru selama nonaktif.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (confirming) onToggleStatus(confirming);
                setConfirming(null);
              }}
            >
              Nonaktifkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
