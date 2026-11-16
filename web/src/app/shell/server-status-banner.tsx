import { formatClock, useServerStatus } from '../server-status';

/** Spanduk "server tidak tersedia, menampilkan data terakhir" (FR-P16); tampil di atas konten, bukan melayang. */
export function ServerStatusBanner() {
  const { unavailableSince } = useServerStatus();
  if (unavailableSince === null) return null;
  return (
    <div
      role="status"
      data-testid="server-status-banner"
      className="break-words border-b bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      Server sedang tidak tersedia — menampilkan data terakhir ({formatClock(unavailableSince)})
    </div>
  );
}
