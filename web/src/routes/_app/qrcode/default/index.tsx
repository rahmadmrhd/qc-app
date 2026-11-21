import type { QrPresetDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { ViewSection } from '@/components/page/view-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ClonePresetDialog } from '@/modules/qrcode/components/clone-preset-dialog';
import { LogoLibraryField } from '@/modules/qrcode/components/logo-library-field';
import { QrPresetsPage } from '@/modules/qrcode/components/qr-presets-page';
import {
  qrDefaultsQueryOptions,
  qrDesignsQueryOptions,
  useClonePreset,
  useRemoveQrPresets,
  useRestoreQrPresets,
  useSaveQrLogoLibrary,
} from '@/modules/qrcode/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['live', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/qrcode/default/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    return Promise.all([
      context.queryClient.ensureQueryData(qrDefaultsQueryOptions(search.status ?? 'live')),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]);
  },
  component: QrPresetsRoute,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; preset: QrPresetDto };

/** Pustaka logo bersama: unggahan berjalan atau gagal menahan Simpan pustaka (`LogoLibraryField.onBusyChange`). */
function LogoLibrarySection({ saved, version }: { saved: readonly string[]; version: string }) {
  const [library, setLibrary] = useState<string[]>([...saved]);
  const [busy, setBusy] = useState(false);
  const save = useSaveQrLogoLibrary();
  const changed = library.join(',') !== saved.join(',');
  return (
    <ViewSection title="Pustaka logo">
      <p className="text-sm text-muted-foreground">
        Logo yang dapat dipilih user saat membuat QR dan sebagai logo awal tiap konfigurasi default.
        Mengeluarkan logo dari pustaka mengosongkan logo awal default yang memakainya.
      </p>
      <LogoLibraryField library={library} onLibraryChange={setLibrary} onBusyChange={setBusy} />
      <div>
        <ActionButton
          action="save"
          label="Simpan pustaka logo"
          busy={save.isPending}
          busyLabel="Menyimpan pustaka logo…"
          disabled={!changed || busy}
          onClick={() =>
            save.mutate(
              { ...(version ? { expectedUpdatedAt: version } : {}), logoFileIds: library },
              {
                onSuccess: () => toast.success('Pustaka logo disimpan'),
                onError: (error) => toast.error(describeError(error)),
              },
            )
          }
        />
      </div>
    </ViewSection>
  );
}

function QrPresetsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const me = useMe();
  const status = search.status ?? 'live';
  const deletedView = status === 'deleted';
  const defaults = useQuery(qrDefaultsQueryOptions(status));
  const businessUnits = useQuery(businessUnitOptionsQueryOptions());
  // Jumlah konfigurasi QR pemakai preset (info pada konfirmasi hapus); tak memblokir hapus.
  const designs = useQuery(qrDesignsQueryOptions());
  const liveDefaults = useQuery({ ...qrDefaultsQueryOptions(), enabled: deletedView });
  const removePresets = useRemoveQrPresets();
  const restorePresets = useRestoreQrPresets();
  const clone = useClonePreset();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [cloning, setCloning] = useState<QrPresetDto | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const termKey = normalizeKey(text);
  const presets = defaults.data?.presets ?? [];
  const visible = presets.filter(
    (preset) => termKey === '' || normalizeKey(preset.name).includes(termKey),
  );
  // Tujuan kloning: BU yang sudah punya preset hidup tak ditawarkan (satu preset per BU).
  const livePresets = deletedView ? (liveDefaults.data?.presets ?? []) : presets;

  const reload = () => void defaults.refetch();
  const remove = useBulkAction({
    selection,
    subject: 'konfigurasi default',
    verb: 'dihapus',
    send: (ids) => removePresets.mutateAsync({ ids }).then((result) => result.ids),
    undo: {
      label: 'Pulihkan',
      run: (ids) => restorePresets.mutateAsync({ ids }).then((result) => result.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'konfigurasi default',
    verb: 'dipulihkan',
    send: (ids) => restorePresets.mutateAsync({ ids }).then((result) => result.items),
    reload,
  });
  const bulkBusy = remove.busy || restore.busy;

  function restoreRow(preset: QrPresetDto) {
    restorePresets.mutate(
      { ids: [preset.id] },
      {
        onSuccess: () => toast.success('Konfigurasi default dipulihkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removePresets.mutate(
      { ids: [target.preset.id] },
      {
        onSuccess: () => toast.success('Konfigurasi default dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const usedBy = (presetId: string) =>
    (designs.data ?? []).filter((design) => design.presetId === presetId).length;
  const usedCount =
    deleteTarget?.kind === 'row'
      ? usedBy(deleteTarget.preset.id)
      : visible
          .filter((preset) => selection.selected.has(preset.id))
          .reduce((sum, preset) => sum + usedBy(preset.id), 0);
  const statusOptions = liveStatusFilterOptions(true);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId =
    restorePresets.isPending && restorePresets.variables?.ids.length === 1
      ? (restorePresets.variables.ids[0] ?? null)
      : removePresets.isPending && removePresets.variables?.ids.length === 1
        ? (removePresets.variables.ids[0] ?? null)
        : null;
  const filtered = termKey !== '' || deletedView;
  const countLabel =
    defaults.isSuccess && (visible.length > 0 || filtered)
      ? `${visible.length} konfigurasi default`
      : undefined;
  const goNew = () => stack.push({ to: '/qrcode/default/new' });

  return (
    <>
      <ListPage
        title="Konfigurasi default QR"
        count={countLabel}
        createAction={{ label: 'Tambah default', onClick: goNew }}
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama konfigurasi default',
              label: 'Cari konfigurasi default',
            }}
          >
            <FilterChip
              label="Status"
              display={status === 'live' ? null : statusLabel}
              onClear={() =>
                void navigate({
                  search: (prev) => ({ ...prev, status: undefined }),
                  replace: true,
                })
              }
            >
              <Select
                id="qr-preset-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={status}
                onValueChange={(next) =>
                  void navigate({
                    search: (prev) => ({ ...prev, status: next as 'live' | 'deleted' }),
                    replace: true,
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
            {deletedView ? (
              <ActionButton action="restore" onClick={() => void restore.run()} />
            ) : (
              <ActionButton action="delete" onClick={() => setDeleteTarget({ kind: 'bulk' })} />
            )}
          </BulkBar>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Tiap Business Unit punya satu konfigurasi default. Saat membuat QR baru dari item, default
          BU item ditarik otomatis (item lintas BU: user memilih satu); semua isian (kecuali sumber
          link) langsung terisi darinya. Mengubah atau menghapus default tidak mengubah QR yang
          sudah dibuat.
        </p>
        <QrPresetsPage
          presets={visible}
          businessUnits={businessUnits.data ?? []}
          deletedView={deletedView}
          canOpenBusinessUnit={businessUnitLinkAccess(me).openBusinessUnitHref !== undefined}
          selection={selection}
          busyId={pendingId}
          onEdit={(preset) =>
            stack.push({ to: '/qrcode/default/$presetId/edit', params: { presetId: preset.id } })
          }
          onClone={setCloning}
          onDelete={(preset) => setDeleteTarget({ kind: 'row', preset })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          isLoading={defaults.isPending}
          isError={defaults.isLoadingError}
          onRetry={reload}
        />
        {deletedView || !defaults.data ? null : (
          <div className="mt-6">
            <LogoLibrarySection
              key={defaults.data.logoUpdatedAt}
              saved={defaults.data.logoFileIds}
              version={defaults.data.logoUpdatedAt}
            />
          </div>
        )}
      </ListPage>
      {cloning ? (
        <ClonePresetDialog
          key={cloning.id}
          open
          onOpenChange={(open) => (open ? undefined : setCloning(null))}
          source={cloning}
          businessUnits={businessUnits.data ?? []}
          presets={livePresets}
          onClone={async (input) => {
            await clone.mutateAsync(input);
            toast.success('Konfigurasi default dikloning');
          }}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="konfigurasi default"
        {...(usedCount > 0
          ? { usage: `Dipakai oleh ${usedCount} konfigurasi QR (QR itu tidak berubah)` }
          : {})}
        onConfirm={confirmDelete}
        busy={remove.busy || removePresets.isPending}
      />
    </>
  );
}
