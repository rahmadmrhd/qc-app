import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { isChunkLoadError, notifyChunkLoadFailure, usePwaUpdate } from '@/app/pwa/update';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';

export function ErrorView({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { needRefresh, reload } = usePwaUpdate();
  // Potongan rute hilang setelah deploy: nyalakan spanduk "Ada versi baru" agar pengguna memuat ulang.
  useEffect(() => {
    if (isChunkLoadError(error)) notifyChunkLoadFailure();
  }, [error]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Alert variant="destructive" className="max-w-md">
        <AlertTitle>Terjadi kesalahan</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{describeError(error)}</p>
          {/* Dengan versi baru tersedia, galat rute umumnya berasal dari potongan lama yang hilang. */}
          {needRefresh && (
            <p>Versi baru aplikasi tersedia. Muat ulang untuk memperbaiki halaman ini.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {needRefresh && (
              <Button size="sm" onClick={reload}>
                Muat ulang
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              Coba lagi
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
