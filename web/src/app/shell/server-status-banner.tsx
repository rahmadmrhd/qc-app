import { Alert } from '@/components/ui/alert';
import { formatClock, useServerStatus } from '../server-status';

/** Spanduk "server tidak tersedia, menampilkan data terakhir" (FR-P16); tampil di atas konten, bukan melayang. */
export function ServerStatusBanner() {
  const { unavailableSince } = useServerStatus();
  if (unavailableSince === null) return null;
  return (
    <Alert
      color="warning"
      role="status"
      data-testid="server-status-banner"
      className="break-words rounded-none border-x-0 border-t-0 px-4"
    >
      Server sedang tidak tersedia — menampilkan data terakhir ({formatClock(unavailableSince)})
    </Alert>
  );
}
