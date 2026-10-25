import { Button } from '@/components/ui/button';

/**
 * Hanya mode dev: masuk lewat `/auth/dev-login` (Worker lokal menerbitkan cookie sesi untuk `DEV_LOGIN_EMAIL` di
 * `worker/.dev.vars`; 404 di luar localhost). Lihat docs/dev-worker.md.
 */
export function DevLoginLink() {
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-xs font-medium text-muted-foreground">
        Mode dev: Worker lokal harus berjalan (bun run dev:worker).
      </p>
      <Button asChild variant="outline" className="w-full">
        <a href="/auth/dev-login">Masuk sebagai pengguna dev</a>
      </Button>
    </div>
  );
}
