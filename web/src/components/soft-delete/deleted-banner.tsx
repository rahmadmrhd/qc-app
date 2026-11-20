import type { SoftDeleteInfo } from '@shared/batch';
import { ActionButton } from '@/components/action-button';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatStamp } from '@/modules/serial/lib/labels';

/**
 * Banner View record terhapus (hanya bagi pemegang izin Pulihkan): "Data ini sudah dihapus", pelaku, waktu WIB, dan
 * tombol Pulihkan bila `canRestore` (rancangan soft delete §4.5).
 */
export function DeletedBanner({
  info,
  canRestore,
  onRestore,
  restoring = false,
}: {
  info: SoftDeleteInfo;
  canRestore: boolean;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  return (
    <Alert color="destructive">
      <AlertTitle>Data ini sudah dihapus</AlertTitle>
      <AlertDescription>
        oleh {info.deletedBy} pada {formatStamp(info.deletedAt)}
      </AlertDescription>
      {canRestore ? (
        <AlertAction>
          <ActionButton action="restore" busy={restoring} onClick={onRestore} />
        </AlertAction>
      ) : null}
    </Alert>
  );
}
