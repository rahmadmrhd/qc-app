import { Button } from '@/components/ui/button';

/**
 * Hanya mode dev: masuk lewat `/auth/dev-login` (server lokal menerbitkan cookie sesi untuk `DEV_LOGIN_EMAIL` di
 * `server/.env`; 404 di luar localhost). Lihat docs/dev-server.md.
 */
export function DevLoginLink() {
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-xs font-medium text-muted-foreground">
        Mode dev: server lokal harus berjalan (bun run dev).
      </p>
      <Button asChild variant="outline" color="primary" className="w-full">
        <a href="/auth/dev-login">Masuk sebagai pengguna dev</a>
      </Button>
    </div>
  );
}
