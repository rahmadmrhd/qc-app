import { useQueryClient } from '@tanstack/react-query';
import { Link, useMatches, useMatchRoute } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { Fragment, useEffect, useReducer } from 'react';
import { findNavTrail, NAV_GROUPS, type NavItem } from '@/app/navigation';
import { buildCrumbs, type CrumbPart } from '@/app/route-meta';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

function CrumbLink({ part }: { part: CrumbPart }) {
  return (
    <BreadcrumbLink asChild>
      {/* `to` berasal dari tabel navigasi/metadata rute yang sudah bertipe; di sini longgar karena dinamis. */}
      <Link to={part.to as NavItem['to']} params={part.params as never}>
        {part.label}
      </Link>
    </BreadcrumbLink>
  );
}

/**
 * Breadcrumb header: induk menu, butir menu, lalu crumb rute (`staticData.crumb`). Nama record dibaca dari
 * cache TanStack Query dan diperbarui saat cache berubah. Di ponsel hanya tingkat terakhir + tombol kembali.
 */
export function AppBreadcrumb() {
  const queryClient = useQueryClient();
  const matches = useMatches();
  const matchRoute = useMatchRoute();
  const isMobile = useIsMobile();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => queryClient.getQueryCache().subscribe(() => bump()), [queryClient]);

  const trail = findNavTrail(NAV_GROUPS, (to, fuzzy) =>
    Boolean(matchRoute({ to: to as NavItem['to'], fuzzy })),
  );
  const crumbs = buildCrumbs({
    trail: trail
      ? { parent: trail.parent, item: { label: trail.item.label, to: trail.item.to as string } }
      : null,
    matches,
    queryClient,
  });
  if (crumbs.length === 0) return null;

  const last = crumbs[crumbs.length - 1] as CrumbPart;

  if (isMobile) {
    const previous = [...crumbs.slice(0, -1)].reverse().find((part) => part.to !== undefined);
    return (
      <Breadcrumb className="flex min-w-0 items-center gap-1">
        {previous ? (
          <Button asChild variant="ghost" size="icon-sm">
            <Link
              to={previous.to as NavItem['to']}
              params={previous.params as never}
              aria-label={`Kembali ke ${previous.label}`}
            >
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : null}
        <BreadcrumbList className="min-w-0 flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{last.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList>
        {crumbs.map((part, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: urutan tingkat tetap; label bisa sama antar tingkat
            <Fragment key={index}>
              <BreadcrumbItem>
                {isLast || !part.to ? (
                  isLast ? (
                    <BreadcrumbPage>{part.label}</BreadcrumbPage>
                  ) : (
                    <span>{part.label}</span>
                  )
                ) : (
                  <CrumbLink part={part} />
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
