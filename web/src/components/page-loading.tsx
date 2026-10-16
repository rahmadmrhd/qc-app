import { Spinner } from './spinner';

/**
 * Tampilan "memuat data" untuk halaman/bagian yang menunggu server. Dipakai sebagai `defaultPendingComponent` router
 * (navigasi langsung berpindah, data menyusul) dan di dalam halaman untuk muatan pertama sebuah daftar.
 */
export function PageLoading({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      <Spinner className="size-6" />
      <span>{label}</span>
    </div>
  );
}
