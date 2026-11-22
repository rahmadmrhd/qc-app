import { MODULES } from '@shared/permissions';
import { createFileRoute } from '@tanstack/react-router';
import { Launcher } from '@/app/shell/launcher';
import { PageContent } from '@/components/page/page-container';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { canAnywhere } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { GuideNotice } from '@/modules/guide/components/guide-notice';

export const Route = createFileRoute('/_app/')({ component: HomePage });

function HomePage() {
  const me = useMe();
  const modules = MODULES.filter((module) => canAnywhere(me, module, 'view'));
  return (
    <PageContent className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Selamat datang, {me.name}</h1>
        <p className="text-muted-foreground">Pilih modul yang ingin dibuka.</p>
      </div>
      <GuideNotice />
      {modules.length === 0 ? (
        <Alert>
          <AlertDescription>
            Anda belum memiliki akses ke modul apa pun. Hubungi admin.
          </AlertDescription>
        </Alert>
      ) : (
        <Launcher />
      )}
    </PageContent>
  );
}
