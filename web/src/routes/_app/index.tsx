import type { ModuleKey } from '@shared/permissions';
import { MODULE_LABELS, MODULES } from '@shared/permissions';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MODULE_LINKS } from '@/app/module-links';
import { Launcher } from '@/app/shell/launcher';
import { PageContent } from '@/components/page/page-container';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { canAnywhere } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { GuideNotice } from '@/modules/guide/components/guide-notice';

export const Route = createFileRoute('/_app/')({ component: HomePage });

function ModuleCard({ module }: { module: ModuleKey }) {
  const to = MODULE_LINKS[module];
  const card = (
    <Card className={to ? 'transition-colors hover:bg-muted/50' : 'opacity-70'}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {MODULE_LABELS[module]}
          {to ? null : (
            <Badge variant="soft" color="secondary">
              Segera hadir
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
    </Card>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

function HomePage() {
  const me = useMe();
  const phone = useIsMobile();
  const modules = MODULES.filter((module) => canAnywhere(me, module, 'view'));
  return (
    <PageContent className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Selamat datang, {me.name}</h1>
        <p className="text-muted-foreground">Pilih modul yang ingin dibuka.</p>
      </div>
      <GuideNotice />
      {phone && modules.length > 0 ? (
        <Launcher />
      ) : modules.length === 0 ? (
        <Alert>
          <AlertDescription>
            Anda belum memiliki akses ke modul apa pun. Hubungi admin.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <ModuleCard key={module} module={module} />
          ))}
        </div>
      )}
    </PageContent>
  );
}
