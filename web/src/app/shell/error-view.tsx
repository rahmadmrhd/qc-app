import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/rpc/describe-error';

export function ErrorView({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Alert variant="destructive" className="max-w-md">
        <AlertTitle>Terjadi kesalahan</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{describeError(error)}</p>
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
        </AlertDescription>
      </Alert>
    </div>
  );
}
