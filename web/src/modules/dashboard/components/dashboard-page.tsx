import { DASHBOARD_GROUPS, GROUP_LABELS } from '@shared/dashboard';
import { wibDateIso } from '@shared/postel';
import { Link } from '@tanstack/react-router';
import { Link2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { HeadroomBar, HeadroomFrame } from '@/components/page/headroom-bar';
import { PageContent } from '@/components/page/page-container';
import { LINE_TAB_LIST_CLASS, LINE_TAB_TRIGGER_CLASS } from '@/components/page/tab-styles';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { visibleWidgetsByGroup } from '../lib/access';
import { type DashboardSearch, effectiveRange } from '../lib/search';
import { GlobalFilters } from './global-filters';
import { GroupSection } from './group-section';
import { ShareDialog } from './share-dialog';

/**
 * Halaman Dashboard pemantauan: bar filter global (BU, Lokasi, Tanggal) dan tab grup di bar headroom, lalu isi satu
 * grup widget yang aktif (satu tab per grup yang boleh dilihat). Widget tanpa hak tak dirender; grup tanpa widget disembunyikan; tanpa satu pun = pesan.
 */
export function DashboardPage({
  search,
  onSearchChange,
}: {
  search: DashboardSearch;
  onSearchChange: (patch: Partial<DashboardSearch>) => void;
}) {
  const me = useMe();
  const phone = useIsMobile();
  const [dialog, setDialog] = useState<'share' | null>(null);
  const canShare = can(me, 'dashboard', 'edit');
  const groups = visibleWidgetsByGroup(me);
  if (groups.length === 0) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Alert>
          <AlertDescription>Anda belum punya akses ke data dashboard.</AlertDescription>
        </Alert>
      </PageContent>
    );
  }
  const today = wibDateIso(Date.now());
  const range = effectiveRange(search, today);
  const all = groups.flatMap((entry) => entry.widgets);
  const filterState = {
    bu: (search.bu?.length ?? 0) > 0,
    location: (search.loc?.length ?? 0) > 0,
    date: true,
  };
  const active = groups.find((entry) => entry.group === search.tab) ?? groups[0];
  return (
    <HeadroomFrame className="gap-4">
      <Tabs
        value={active?.group}
        onValueChange={(value) => {
          const group = DASHBOARD_GROUPS.find((item) => item === value);
          if (group) onSearchChange({ tab: group });
        }}
        className="gap-4"
      >
        <HeadroomBar className="space-y-3 pt-1 pb-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className={cn('text-xl font-semibold', phone && 'sr-only')}>Dashboard</h1>
            {canShare ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="solid"
                  color="primary"
                  onClick={() => setDialog('share')}
                >
                  <Share2 aria-hidden="true" />
                  Bagikan
                </Button>
                <Button asChild size="sm" variant="outline" color="secondary">
                  <Link to="/dashboard/tautan">
                    <Link2 aria-hidden="true" />
                    Tautan dibagikan
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
          <GlobalFilters
            me={me}
            search={search}
            today={today}
            range={range}
            showBu={all.some((meta) => meta.bu)}
            showLocation={all.some((meta) => meta.location !== 'none')}
            onChange={onSearchChange}
          />
          <TabsList variant="line" className={LINE_TAB_LIST_CLASS}>
            {groups.map((entry) => (
              <TabsTrigger
                key={entry.group}
                value={entry.group}
                data-tour={`dashboard-tab-${entry.group}`}
                className={LINE_TAB_TRIGGER_CLASS}
              >
                {GROUP_LABELS[entry.group]}
              </TabsTrigger>
            ))}
          </TabsList>
        </HeadroomBar>
        {groups.map((entry) => (
          <TabsContent key={entry.group} value={entry.group}>
            <GroupSection
              group={entry.group}
              widgets={entry.widgets}
              search={search}
              today={today}
              filterState={filterState}
              onChange={onSearchChange}
            />
          </TabsContent>
        ))}
      </Tabs>
      {dialog === 'share' ? (
        <ShareDialog onClose={() => setDialog(null)} search={search} today={today} />
      ) : null}
    </HeadroomFrame>
  );
}
