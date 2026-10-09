import type { AuditEntryDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { NativeSelect } from '@/components/native-select';
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
  auditQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
} from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';

const auditSearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  action: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/audit')({
  validateSearch: (search: Record<string, unknown>) => auditSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        auditQueryOptions({ page: deps.page, action: deps.action, query: deps.q }),
      ),
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
  const { data: result } = useSuspenseQuery(
    auditQueryOptions({ page: search.page, action: search.action, query: search.q }),
  );
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  // Kata kunci dikirim ke server; tunda agar tidak memanggil RPC pada setiap ketukan.
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) => {
    void navigate({
      search: (prev) => ({ ...prev, q: value || undefined, page: undefined }),
      replace: true,
    });
  });

  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));
  const page = result.page;
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));

  function goTo(next: number) {
    void navigate({ search: (prev) => ({ ...prev, page: next <= 1 ? undefined : next }) });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Log Audit</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari target atau pelaku"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <NativeSelect
          aria-label="Filter aksi"
          className="sm:w-56"
          value={search.action ?? ''}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                action: event.target.value || undefined,
                page: undefined,
              }),
              replace: true,
            })
          }
        >
          <option value="">Semua aksi</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <AuditTable entries={result.entries} onSelect={setSelected} />
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {result.total} catatan · halaman {page} dari {lastPage}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Sebelumnya
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => goTo(page + 1)}
          >
            Berikutnya
          </Button>
        </div>
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
