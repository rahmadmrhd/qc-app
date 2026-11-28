import type { ClBundleDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type DataColumn, DataTable, LinkCell } from '@/components/data-table';
import { ListPage } from '@/components/page/list-page';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { formatStamp } from '@/lib/format-stamp';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { bundlesQueryOptions, draftQueryOptions } from '../queries';
import { PublishDialog } from './publish-dialog';

/** Asal bundel: diterbitkan dari draf, atau hasil mengaktifkan ulang bundel lama. */
export function bundleOrigin(bundle: Pick<ClBundleDto, 'sourceNumber'>): string {
  return bundle.sourceNumber === null
    ? 'Dari draf'
    : `Diaktifkan ulang dari #${bundle.sourceNumber}`;
}

/**
 * Daftar bundel terbit Country Lock (kit CRUD), terbaru di atas; bundel terbaru = yang AKTIF (diunduh desktop).
 * "Terbitkan" hanya bagi `countrylock: manage`. Banner menunjukkan apakah draf berbeda dari bundel terbit terakhir.
 */
export function BundlesPage() {
  const me = useMe();
  const stack = useStackNavigation();
  const canManage = can(me, 'countrylock', 'manage');
  const list = useQuery(bundlesQueryOptions());
  const draft = useQuery(draftQueryOptions());
  const [publishOpen, setPublishOpen] = useState(false);

  const bundles = [...(list.data ?? [])].sort((a, b) => b.number - a.number);
  const activeNumber = bundles[0]?.number;
  const errorCount = draft.data?.issues.filter((issue) => issue.severity === 'error').length ?? 0;

  const columns: DataColumn<ClBundleDto>[] = [
    {
      id: 'number',
      header: 'Bundel',
      mobile: 'title',
      cell: (bundle) => (
        <span className="inline-flex items-center gap-2">
          <LinkCell to="/countrylock/bundles/$number" params={{ number: String(bundle.number) }}>
            #{bundle.number}
          </LinkCell>
          {bundle.number === activeNumber ? (
            <Badge variant="solid" color="success">
              Aktif
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'note', header: 'Catatan', cell: (bundle) => bundle.note },
    { id: 'origin', header: 'Asal', cell: (bundle) => bundleOrigin(bundle) },
    { id: 'files', header: 'Berkas', align: 'right', cell: (bundle) => bundle.fileCount },
    { id: 'by', header: 'Diterbitkan oleh', cell: (bundle) => bundle.publishedBy },
    {
      id: 'at',
      header: 'Waktu',
      className: 'text-sm text-muted-foreground',
      cell: (bundle) => formatStamp(bundle.createdAt),
    },
  ];

  return (
    <>
      <ListPage
        title="Bundel Country Lock"
        count={list.isSuccess && bundles.length > 0 ? `${bundles.length} bundel` : undefined}
        {...(canManage
          ? {
              createAction: {
                label: 'Terbitkan',
                kind: 'upload',
                onClick: () => setPublishOpen(true),
              },
            }
          : {})}
      >
        {draft.data ? (
          <Alert
            color={errorCount > 0 ? 'destructive' : draft.data.changed ? 'info' : 'success'}
            className="mb-3"
          >
            <AlertDescription>
              {draft.data.changed
                ? 'Draf punya perubahan yang belum diterbitkan.'
                : 'Draf sama dengan bundel terbit terakhir.'}
              {errorCount > 0
                ? ` Ada ${errorCount} masalah yang harus diperbaiki sebelum terbit.`
                : ''}
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="mb-3 text-sm text-muted-foreground">
          Bundel tidak dapat diubah setelah terbit. Aplikasi desktop memakai bundel terbaru; memilih
          bundel lama menerbitkannya lagi sebagai bundel baru.
        </p>
        <DataTable
          rows={bundles}
          rowKey={(bundle) => String(bundle.number)}
          columns={columns}
          label="Daftar bundel Country Lock"
          rowTo={(bundle) => ({
            to: '/countrylock/bundles/$number',
            params: { number: String(bundle.number) },
          })}
          empty="Belum ada bundel terbit."
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={() => void list.refetch()}
        />
      </ListPage>
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onPublished={(bundle) =>
          stack.push({
            to: '/countrylock/bundles/$number',
            params: { number: String(bundle.number) },
          })
        }
      />
    </>
  );
}
