import { formatBuLabel } from '@shared/business-units';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { formatDay } from '@/modules/serial/lib/labels';
import { warehouseReadyQueryOptions } from '../queries';
import { DISPATCH_STATUS, DispatchSection } from './dispatch-section';

export interface ReadyDetailPageProps {
  readyId: string;
}

/** Catatan tak ada atau di luar hak baca: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

/**
 * Detail pencatatan ready (kit `ViewPage`): ringkasan, daftar Serial Number dengan Salin ulang, dan Log aktivitas.
 * Tanpa tautan task Serah Terima (tak ada SO). Catatan tak terbaca = "tidak ditemukan".
 */
export function ReadyDetailPage({ readyId }: ReadyDetailPageProps) {
  const query = useQuery(warehouseReadyQueryOptions(readyId));
  const ready = query.data;

  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (query.isError || !ready) {
    const missing = isMissing(query.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Catatan ready tidak ditemukan' : 'Catatan ready tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(query.error)}
          </p>
        )}
        <Button asChild variant="outline" color="primary">
          <Link to="/serial/gudang/riwayat" search={{ tab: 'ready' }}>
            Kembali ke Riwayat Gudang
          </Link>
        </Button>
      </PageContent>
    );
  }

  const status = DISPATCH_STATUS[ready.status];
  return (
    <ViewPage
      title={`Ready ${formatDay(ready.dispatchedOn)}`}
      badge={
        <Badge variant="soft" color={status.color}>
          {status.label}
        </Badge>
      }
      aside={
        <>
          <ViewMeta
            createdBy={ready.createdBy}
            createdAt={ready.createdAt}
            updatedAt={ready.completedAt || ready.createdAt}
          />
          <ActivityLog kind="warehouseReady" id={ready.id} createdAt={ready.createdAt} />
        </>
      }
    >
      <ViewSection title="Ringkasan">
        <DetailList
          items={[
            { label: 'Tujuan', value: 'Catat ready (tanpa SO)' },
            {
              label: 'Business Unit',
              value: (
                <Badge variant="outline" color="primary">
                  {formatBuLabel({ code: ready.buCode, name: ready.buName })}
                </Badge>
              ),
            },
            { label: 'Tipe', value: ready.itemLabel },
            { label: 'Tanggal catat', value: formatDay(ready.dispatchedOn) },
            { label: 'Serial Number', value: ready.serialTotal },
          ]}
        />
      </ViewSection>
      <ViewSection title="Serial Number">
        <DispatchSection dispatch={ready} canEdit={ready.canEdit} />
      </ViewSection>
    </ViewPage>
  );
}
