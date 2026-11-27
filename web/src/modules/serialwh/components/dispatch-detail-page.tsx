import { formatBuLabel } from '@shared/business-units';
import { WAREHOUSE_KIND_LABEL } from '@shared/serial-warehouse';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageContent } from '@/components/page/page-container';
import {
  DetailList,
  type ViewAction,
  ViewMeta,
  ViewPage,
  ViewSection,
} from '@/components/page/view-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { useMe } from '@/modules/auth/use-me';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { formatDay } from '@/modules/serial/lib/labels';
import { draftDispatchId } from '../lib/draft-store';
import { warehouseDispatchQueryOptions } from '../queries';
import { DISPATCH_STATUS, DispatchSerials, useCopyDispatch } from './dispatch-section';

export interface DispatchDetailPageProps {
  dispatchId: string;
}

/** Catatan tak ada atau di luar hak baca: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

/**
 * Detail satu pengeluaran Gudang (Penjualan atau Ready Stock; kit `ViewPage`): ringkasan, task Serah Terima tertaut
 * (hanya Penjualan; dikelola di detail SO), dan daftar Serial Number yang langsung tampil. "Salin ulang" ada di aksi
 * halaman (hanya pengeluaran selesai). Pengeluaran `pending` memberi "Lanjutkan" bila draf pengirimnya ada di perangkat
 * ini. Pengeluaran tak terbaca = "tidak ditemukan".
 */
export function DispatchDetailPage({ dispatchId }: DispatchDetailPageProps) {
  const me = useMe();
  const stack = useStackNavigation();
  const query = useQuery(warehouseDispatchQueryOptions(dispatchId));
  const copy = useCopyDispatch(dispatchId);
  const dispatch = query.data;

  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (query.isError || !dispatch) {
    const missing = isMissing(query.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Pengeluaran tidak ditemukan' : 'Pengeluaran tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(query.error)}
          </p>
        )}
        <Button asChild variant="outline" color="primary">
          <Link to="/serial/gudang/riwayat">Kembali ke Riwayat Gudang</Link>
        </Button>
      </PageContent>
    );
  }

  const status = DISPATCH_STATUS[dispatch.status];
  const hasDraft = draftDispatchId(me.email) === dispatch.id;
  const actionItems: ViewAction[] = [
    {
      id: 'copy',
      action: 'copy',
      label: 'Salin ulang',
      onSelect: () => void copy.copyAgain(),
      busy: copy.copying,
      hidden: dispatch.status !== 'done',
      primary: true,
    },
  ];

  return (
    <>
      <ViewPage
        title={dispatch.number}
        badge={
          <Badge variant="soft" color={status.color}>
            {status.label}
          </Badge>
        }
        actionItems={actionItems}
        aside={
          <>
            <ViewMeta
              createdBy={dispatch.createdBy}
              createdAt={dispatch.createdAt}
              updatedAt={dispatch.completedAt || dispatch.createdAt}
            />
            {dispatch.kind === 'ready' ? (
              <ActivityLog kind="warehouseReady" id={dispatch.id} createdAt={dispatch.createdAt} />
            ) : (
              <ActivityLog
                kind="warehouseOrder"
                id={dispatch.orderId}
                createdAt={dispatch.createdAt}
              />
            )}
          </>
        }
      >
        <ViewSection title="Ringkasan">
          <DetailList
            items={[
              { label: 'No Riwayat', value: dispatch.number },
              { label: 'Jenis', value: WAREHOUSE_KIND_LABEL[dispatch.kind] },
              {
                label: 'No SO',
                hidden: dispatch.orderId === '',
                value: (
                  <Link
                    to="/serial/gudang/riwayat/so/$orderId"
                    params={{ orderId: dispatch.orderId }}
                    className="text-info-text underline-offset-4 hover:underline"
                  >
                    {dispatch.orderNumber}
                  </Link>
                ),
              },
              {
                label: 'Business Unit',
                value: (
                  <Badge variant="outline" color="primary">
                    {formatBuLabel({ code: dispatch.buCode, name: dispatch.buName })}
                  </Badge>
                ),
              },
              {
                label: 'Customer',
                hidden: dispatch.kind === 'ready',
                value: dispatch.customerName || 'Tanpa customer',
              },
              { label: 'Tipe', value: dispatch.itemLabel || '—' },
              { label: 'Tanggal', value: formatDay(dispatch.dispatchedOn) },
              {
                label: 'Serial Number',
                value:
                  dispatch.createdCount > 0
                    ? `${dispatch.serialCount} (${dispatch.createdCount} dibuat saat keluar)`
                    : dispatch.serialCount,
              },
              {
                label: 'Dicatat oleh',
                value: `${dispatch.createdBy} · ${formatStamp(dispatch.createdAt)}`,
              },
              { label: 'Catatan', hidden: dispatch.note === '', value: dispatch.note },
            ]}
          />
        </ViewSection>

        {dispatch.status === 'pending' ? (
          <ViewSection title="Belum selesai">
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {dispatch.chunksReceived} dari {dispatch.chunkCount} potongan terkirim.
              </p>
              {dispatch.canEdit && hasDraft ? (
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  onClick={() => stack.push({ to: '/serial/gudang' })}
                >
                  Lanjutkan
                </Button>
              ) : (
                <p className="text-muted-foreground">
                  Draf tidak ada di perangkat ini; pengeluaran dibatalkan otomatis setelah 7 hari.
                </p>
              )}
            </div>
          </ViewSection>
        ) : null}

        {dispatch.kind === 'order' ? (
          <ViewSection title="Task Serah Terima">
            {dispatch.handovers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada task Serah Terima tertaut pada SO ini.
              </p>
            ) : (
              <ul className="divide-y" aria-label="Task Serah Terima tertaut">
                {dispatch.handovers.map((handover) => (
                  <li
                    key={handover.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    {handover.readable ? (
                      <Link
                        to="/handover/$handoverId"
                        params={{ handoverId: handover.id }}
                        className="font-medium text-info-text underline-offset-4 hover:underline"
                      >
                        {handover.number}
                      </Link>
                    ) : (
                      <span className="font-medium" title="Tidak ada akses ke task ini">
                        {handover.number}
                      </span>
                    )}
                    <HandoverStatusBadge status={handover.status} />
                    <span className="text-xs text-muted-foreground">
                      {handover.customerName ? `${handover.customerName} · ` : ''}
                      {handover.createdAt ? formatStamp(handover.createdAt) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ViewSection>
        ) : null}

        {dispatch.status !== 'cancelled' ? (
          <ViewSection title="Serial Number">
            <DispatchSerials dispatchId={dispatch.id} />
          </ViewSection>
        ) : null}
      </ViewPage>
      {copy.dialog}
    </>
  );
}
