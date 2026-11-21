import type { AuditEntryDto } from '@shared/contract';
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { PageLoading } from '@/components/page-loading';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AuditDiffView } from '@/modules/access/components/audit-diff-view';
import { AuditTable } from '@/modules/access/components/audit-table';
import {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
  formatAuditTime,
} from '@/modules/access/lib/audit-actions';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  auditInfiniteQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
} from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';

const auditSearchSchema = z.object({
  action: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/audit')({
  validateSearch: (search: Record<string, unknown>) => auditSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  // Tanpa loaderDeps: ganti filter/kata kunci tidak memuat ulang route (halaman tidak diganti tampilan
  // "memuat"); daftar mengambil datanya sendiri dan menahan baris lama selama memuat. Loader hanya menyiapkan data
  // referensi dan memulai pengambilan daftar awal bersamaan (satu eksekusi batch) tanpa menunggunya.
  loader: async ({ context, location }) => {
    const search = auditSearchSchema.parse(location.search);
    void context.queryClient.prefetchInfiniteQuery(
      auditInfiniteQueryOptions({ action: search.action, query: search.q }),
    );
    await Promise.all([
      context.queryClient.ensureQueryData(rolesQueryOptions()),
      context.queryClient.ensureQueryData(locationsQueryOptions()),
    ]);
  },
  component: AuditPage,
});

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const auditQuery = useInfiniteQuery({
    ...auditInfiniteQueryOptions({ action: search.action, query: search.q }),
    placeholderData: keepPreviousData,
  });
  const entries = auditQuery.data?.pages.flatMap((page) => page.entries);
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  // Kata kunci dikirim ke server; tunda agar tidak memanggil API pada setiap ketukan.
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) => {
    void navigate({
      search: (prev) => ({ ...prev, q: value || undefined }),
      replace: true,
    });
  });

  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Log Audit</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari target atau pelaku"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Select
          id="audit-filter-action"
          label="Filter aksi"
          hideLabel
          className="sm:w-56"
          options={[
            { value: '', label: 'Semua aksi' },
            ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          value={search.action ?? ''}
          onValueChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, action: next || undefined }),
              replace: true,
            })
          }
        />
      </div>
      {entries ? (
        <div
          aria-busy={auditQuery.isFetching}
          className={auditQuery.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        >
          <AuditTable entries={entries} onSelect={setSelected} />
        </div>
      ) : auditQuery.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          Log audit gagal dimuat.
        </p>
      ) : (
        <PageLoading label="Memuat log audit…" />
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {entries ? `${entries.length} catatan dimuat` : ''}
          {auditQuery.isFetching && entries ? ' · memuat…' : ''}
        </span>
        {auditQuery.hasNextPage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={auditQuery.isFetchingNextPage}
            onClick={() => void auditQuery.fetchNextPage()}
          >
            {auditQuery.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        ) : null}
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {auditActionLabel(selected.action)}: {selected.target}
                </SheetTitle>
                <SheetDescription>
                  {selected.actor} · {formatAuditTime(selected.ts)}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <AuditDiffView
                  before={selected.before}
                  after={selected.after}
                  roleNames={roleNames}
                  locationNames={locationNames}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
