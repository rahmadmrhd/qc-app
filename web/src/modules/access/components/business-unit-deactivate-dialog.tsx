import type { BusinessUnitDto } from '@shared/contract';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** BU yang masih dipakai tetap boleh dinonaktifkan, tetapi pemegang akses diberi tahu dampaknya lebih dulu. */
export function needsDeactivateConfirmation(
  businessUnit: Pick<BusinessUnitDto, 'status' | 'itemCount' | 'userCount'>,
): boolean {
  return (
    businessUnit.status === 'active' && (businessUnit.itemCount > 0 || businessUnit.userCount > 0)
  );
}

export interface BusinessUnitDeactivateDialogProps {
  /** BU yang akan dinonaktifkan (satu dari baris/View, banyak dari aksi massal); kosong = dialog tertutup. */
  businessUnits: readonly BusinessUnitDto[];
  onCancel: () => void;
  onConfirm: () => void;
}

/** Konfirmasi nonaktifkan BU yang masih dipakai (dipakai daftar, aksi massal, dan View BU). */
export function BusinessUnitDeactivateDialog({
  businessUnits,
  onCancel,
  onConfirm,
}: BusinessUnitDeactivateDialogProps) {
  const [first] = businessUnits;
  const single = businessUnits.length === 1 ? first : undefined;
  const items = businessUnits.reduce((sum, bu) => sum + bu.itemCount, 0);
  const users = businessUnits.reduce((sum, bu) => sum + bu.userCount, 0);
  return (
    <AlertDialog
      open={businessUnits.length > 0}
      onOpenChange={(open) => (open ? undefined : onCancel())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single ? `Nonaktifkan BU ${single.name}?` : `Nonaktifkan ${businessUnits.length} BU?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {single ? 'BU ini masih dipakai oleh' : 'BU terpilih masih dipakai oleh total'} {items}{' '}
            item dan {users} user aktif. Item dan hak yang sudah ada tetap berlaku, tetapi BU yang
            nonaktif tidak dapat ditambahkan ke data baru.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Nonaktifkan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
