import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useHasUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { isChunkLoadError, notifyChunkLoadFailure, usePwaUpdate } from '@/app/pwa/update';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';

export function ErrorView({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { needRefresh, pending, reload } = usePwaUpdate();
  const unsaved = useHasUnsavedChanges();
  // Potongan rute hilang setelah deploy: nyalakan spanduk "Ada versi baru" agar pengguna memuat ulang.
  useEffect(() => {
    if (isChunkLoadError(error)) notifyChunkLoadFailure();
  }, [error]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Alert color="destructive" icon={false} className="max-w-md">
        <AlertTitle>Terjadi kesalahan</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{describeError(error)}</p>
          {/* Dengan versi baru tersedia, galat rute umumnya berasal dari potongan lama yang hilang. */}
          {needRefresh && (
            <p>
              {unsaved
                ? 'Ada formulir yang belum disimpan; perubahan itu akan hilang bila dimuat ulang.'
                : 'Versi baru aplikasi tersedia; muat ulang bila galat berlanjut.'}
            </p>
          )}
          {/* Live region: pembaca layar mengumumkan bahwa muat ulang sedang berjalan (tombol tak lagi nonaktif/hilang fokus). */}
          <p role="status" className="sr-only">
            {pending ? 'Memuat versi baru…' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {needRefresh && (
              <Button
                size="sm"
                onClick={reload}
                aria-disabled={pending}
                aria-busy={pending}
                className="aria-disabled:opacity-50"
              >
                {pending ? 'Memuat…' : 'Muat ulang'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              color="primary"
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
