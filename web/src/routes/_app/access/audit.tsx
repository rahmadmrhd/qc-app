import type { AuditEntryDto } from '@shared/contract';
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { MultiSelect } from '@/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AuditDiffView } from '@/modules/access/components/audit-diff-view';
import { AuditTable } from '@/modules/access/components/audit-table';
import { useDeletedNames } from '@/modules/access/lib/assignment-labels';
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
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const auditSearchSchema = z.object({
  /** Aksi yang disaring (banyak nilai = salah satu dari). */
  actions: z.array(z.string().max(100)).max(20).optional().catch(undefined),
  /** Satu aksi: param tunggal lama yang masih diterima; dibaca sebagai `actions`. */
  action: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

/** Aksi yang berlaku: param jamak, atau param tunggal lama sebagai daftar satu nilai. */
const actionsOf = (search: z.infer<typeof auditSearchSchema>): string[] =>
  search.actions ?? (search.action ? [search.action] : []);

export const Route = createFileRoute('/_app/access/audit')({
  validateSearch: (search: Record<string, unknown>) => auditSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  // Tanpa loaderDeps: ganti filter/kata kunci tidak memuat ulang route (halaman tidak diganti tampilan
  // "memuat"); daftar mengambil datanya sendiri dan menahan baris lama selama memuat. Loader hanya menyiapkan data
  // referensi dan memulai pengambilan daftar awal bersamaan (satu eksekusi batch) tanpa menunggunya.
  loader: async ({ context, location }) => {
    const search = auditSearchSchema.parse(location.search);
    void context.queryClient.prefetchInfiniteQuery(
      auditInfiniteQueryOptions({ actions: actionsOf(search), query: search.q }),
    );
    await Promise.all([
      context.queryClient.ensureQueryData(rolesQueryOptions()),
      context.queryClient.ensureQueryData(locationsQueryOptions()),
    ]);
  },
  component: AuditPage,
});

const ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'id'));

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const actions = actionsOf(search);
  const deletedNames = useDeletedNames(can(me, 'access', 'manage'));
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const auditQuery = useInfiniteQuery({
    ...auditInfiniteQueryOptions({ actions, query: search.q }),
    placeholderData: keepPreviousData,
  });
  const entries = auditQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  // Kata kunci dikirim ke server; tunda agar tidak memanggil API pada setiap ketukan.
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) => {
    void navigate({
      search: (prev) => ({ ...prev, q: value || undefined }),
      replace: true,
    });
  });

  // Role/lokasi yang sudah dihapus tetap diberi nama pada diff (hanya pemegang `access: manage` yang memuat daftarnya).
  const roleNames = new Map([
    ...deletedNames.roles,
    ...roles.map((role) => [role.id, role.name] as const),
  ]);
  const locationNames = new Map([
    ...deletedNames.locations,
    ...locations.map((l) => [l.id, l.name] as const),
  ]);
  const filtered = text.trim() !== '' || actions.length > 0;
  return (
    <>
      <ListPage
        title="Log Audit"
        count={
          auditQuery.isSuccess && (entries.length > 0 || filtered)
            ? `${entries.length} catatan dimuat`
            : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari target atau pelaku',
              label: 'Cari log audit',
            }}
          >
            <FilterChip
              label="Aksi"
              display={multiFilterDisplay(actions.map(auditActionLabel))}
              onClear={() =>
                void navigate({
                  search: (prev) => ({ ...prev, actions: undefined, action: undefined }),
                  replace: true,
                })
              }
            >
              <MultiSelect
                id="audit-filter-action"
                label="Filter aksi"
                hideLabel
                placeholder="Semua aksi"
                options={ACTION_OPTIONS}
                value={actions}
                onValueChange={(next) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      actions: next.length > 0 ? next : undefined,
                      action: undefined,
                    }),
                    replace: true,
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
      >
        <AuditTable
          entries={entries}
          me={me}
          onSelect={setSelected}
          hasMore={auditQuery.hasNextPage}
          loadingMore={auditQuery.isFetchingNextPage}
          loadMoreError={auditQuery.isFetchNextPageError}
          onLoadMore={() => void auditQuery.fetchNextPage()}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          isLoading={auditQuery.isPending}
          isError={auditQuery.isLoadingError}
          onRetry={() => void auditQuery.refetch()}
        />
      </ListPage>
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
    </>
  );
}
