import { formatBuLabel } from '@shared/business-units';
import type { WarehouseLinkedHandoverDto, WarehouseOrderDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Link2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { describeSaveError } from '@/modules/access/lib/stale';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { formatDay } from '@/modules/serial/lib/labels';
import { useSetWarehouseOrderLinks, warehouseOrderQueryOptions } from '../queries';
import { DispatchSection } from './dispatch-section';
import { LinkHandoversDialog } from './link-handovers-dialog';

export interface OrderDetailPageProps {
  orderId: string;
}

/** Catatan tak ada atau di luar hak baca: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function HandoverRow({
  handover,
  canEdit,
  removing,
  onRemove,
}: {
  handover: WarehouseLinkedHandoverDto;
  canEdit: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
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
        {formatStamp(handover.createdAt)}
      </span>
      {canEdit && handover.readable ? (
        <Button
          type="button"
          variant="ghost"
          color="destructive"
          size="sm"
          className="ml-auto"
          disabled={removing}
          aria-label={`Lepas task ${handover.number}`}
          onClick={onRemove}
        >
          <X aria-hidden />
          Lepas
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Detail catatan SO (kit `ViewPage`): ringkasan, task Serah Terima tertaut (nomor menaut ke task hanya bila terbaca;
 * "Tautkan task" dan "Lepas" hanya bagi `canEdit`) dan daftar pengeluaran dengan Salin ulang. Catatan tak terbaca =
 * "tidak ditemukan".
 */
export function OrderDetailPage({ orderId }: OrderDetailPageProps) {
  const query = useQuery(warehouseOrderQueryOptions(orderId));
  const setLinks = useSetWarehouseOrderLinks();
  const [linking, setLinking] = useState(false);
  const order: WarehouseOrderDto | undefined = query.data;

  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (query.isError || !order) {
    const missing = isMissing(query.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Catatan SO tidak ditemukan' : 'Catatan SO tidak dapat dimuat'}
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

  const readableIds = order.handovers.filter((h) => h.readable).map((h) => h.id);
  function removeLink(handoverId: string) {
    if (!order) return;
    setLinks.mutate(
      {
        id: order.id,
        expectedUpdatedAt: order.updatedAt,
        handoverIds: readableIds.filter((id) => id !== handoverId),
      },
      {
        onSuccess: () => toast.success('Tautan task dilepas'),
        onError: (error) => toast.error(describeSaveError(error)),
      },
    );
  }

  return (
    <>
      <ViewPage
        title={order.number}
        badge={
          order.hasPending ? (
            <Badge variant="soft" color="warning">
              Belum selesai
            </Badge>
          ) : (
            <Badge variant="soft" color="success">
              Selesai
            </Badge>
          )
        }
        aside={
          <>
            <ViewMeta
              createdBy={order.createdBy}
              createdAt={order.createdAt}
              updatedAt={order.updatedAt}
            />
            <ActivityLog kind="warehouseOrder" id={order.id} createdAt={order.createdAt} />
          </>
        }
      >
        <ViewSection title="Ringkasan">
          <DetailList
            items={[
              { label: 'No SO', value: order.number },
              {
                label: 'Business Unit',
                value: (
                  <Badge variant="outline" color="primary">
                    {formatBuLabel({ code: order.buCode, name: order.buName })}
                  </Badge>
                ),
              },
              { label: 'Customer', value: order.customerName || 'Tanpa customer' },
              { label: 'Pengeluaran', value: order.dispatchCount },
              { label: 'Serial Number', value: order.serialCount },
              {
                label: 'Keluar terakhir',
                value: order.lastDispatchedOn ? formatDay(order.lastDispatchedOn) : '—',
              },
            ]}
          />
        </ViewSection>

        <ViewSection title="Task Serah Terima">
          <div className="space-y-2">
            {order.handovers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada task Serah Terima tertaut.</p>
            ) : (
              <ul className="divide-y" aria-label="Task Serah Terima tertaut">
                {order.handovers.map((handover) => (
                  <HandoverRow
                    key={handover.id}
                    handover={handover}
                    canEdit={order.canEdit}
                    removing={setLinks.isPending}
                    onRemove={() => removeLink(handover.id)}
                  />
                ))}
              </ul>
            )}
            {order.canEdit ? (
              <Button
                type="button"
                variant="outline"
                color="primary"
                onClick={() => setLinking(true)}
              >
                <Link2 aria-hidden data-icon="inline-start" />
                Tautkan task
              </Button>
            ) : null}
          </div>
        </ViewSection>

        <ViewSection title="Pengeluaran">
          {order.dispatches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pengeluaran.</p>
          ) : (
            <div className="space-y-3">
              {order.dispatches.map((dispatch) => (
                <DispatchSection key={dispatch.id} dispatch={dispatch} canEdit={order.canEdit} />
              ))}
            </div>
          )}
        </ViewSection>
      </ViewPage>
      {order.canEdit ? (
        <LinkHandoversDialog order={order} open={linking} onOpenChange={setLinking} />
      ) : null}
    </>
  );
}
