import { Button } from '@/components/ui/button';

/** Layar boot saat server tidak terjangkau (FR-P7): tanpa router/query client, hanya tombol coba lagi. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">Tidak ada koneksi</h1>
        <p className="text-sm text-muted-foreground">
          Server belum bisa dihubungi. Cek koneksi Anda, lalu coba lagi.
        </p>
        <Button onClick={onRetry}>Coba lagi</Button>
      </div>
    </main>
  );
}
