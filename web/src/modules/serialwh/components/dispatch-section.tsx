import type { WarehouseDispatchDto, WarehouseDispatchSerialDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { type DataColumn, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { useMe } from '@/modules/auth/use-me';
import { formatDay } from '@/modules/serial/lib/labels';
import { copyLines } from '../lib/clipboard';
import { draftDispatchId } from '../lib/draft-store';
import { fetchWarehouseCopyText, warehouseDispatchSerialsQueryOptions } from '../queries';
import { ClipboardResultDialog } from './clipboard-result-dialog';

export const DISPATCH_STATUS = {
  pending: { label: 'Belum selesai', color: 'warning' },
  done: { label: 'Selesai', color: 'success' },
  cancelled: { label: 'Dibatalkan otomatis', color: 'destructive' },
} as const;

const SERIAL_COLUMNS: DataColumn<WarehouseDispatchSerialDto>[] = [
  { id: 'seq', header: 'No', cell: (row) => row.seq + 1 },
  {
    id: 'serial',
    header: 'Serial Number',
    mobile: 'title',
    cell: (row) => <span className="font-mono">{row.serial}</span>,
  },
  {
    id: 'flags',
    header: 'Keterangan',
    mobile: 'badge',
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.createdNew ? (
          <Badge variant="soft" color="info">
            Dibuat saat keluar
          </Badge>
        ) : null}
        {row.deleted ? (
          <Badge variant="soft" color="destructive">
            Terhapus
          </Badge>
        ) : null}
      </span>
    ),
  },
];

/** Tabel Serial Number satu pengeluaran (berkursor `seq`); dimuat hanya setelah dibuka. */
export function DispatchSerials({ dispatchId }: { dispatchId: string }) {
  const list = useInfiniteQuery(warehouseDispatchSerialsQueryOptions(dispatchId));
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => `${row.seq}`}
      columns={SERIAL_COLUMNS}
      label="Serial Number pengeluaran"
      fit="content"
      empty="Belum ada Serial Number."
      isLoading={list.isPending}
      isError={list.isLoadingError}
      onRetry={() => void list.refetch()}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      loadMoreError={list.isFetchNextPageError}
      onLoadMore={() => void list.fetchNextPage()}
    />
  );
}

/**
 * "Salin ulang" satu pengeluaran selesai: janji teks dilempar langsung ke clipboard dari gestur klik (cadangan dialog
 * bila clipboard ditolak). `dialog` WAJIB dirender pemanggil.
 */
export function useCopyDispatch(dispatchId: string) {
  const [copied, setCopied] = useState<{ text: string; count: number } | null>(null);
  const [copying, setCopying] = useState(false);

  async function copyAgain() {
    setCopying(true);
    const fetched = fetchWarehouseCopyText(dispatchId);
    fetched.catch(() => undefined);
    try {
      const ok = await copyLines(fetched.then((result) => result.text));
      const result = await fetched;
      if (ok) toast.success(`${result.count} Serial Number disalin`);
      else setCopied(result);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setCopying(false);
    }
  }

  const dialog = (
    <ClipboardResultDialog
      open={copied !== null}
      onOpenChange={(next) => {
        if (!next) setCopied(null);
      }}
      text={copied?.text ?? ''}
      count={copied?.count ?? 0}
    />
  );
  return { copyAgain, copying, dialog };
}

export interface DispatchSectionProps {
  dispatch: WarehouseDispatchDto;
  /** `serialwh: edit` pada BU SO: "Lanjutkan" hanya bagi pengguna ini. */
  canEdit: boolean;
}

/**
 * Satu pengeluaran pada detail SO: tanggal, Tipe, jumlah, pelaku, catatan, status, "Salin ulang" (hanya yang selesai)
 * dan tabel Serial Number. Pengeluaran `pending` memberi "Lanjutkan" bila draf pengirimnya ada di perangkat ini
 * (`submission.dispatchId` cocok), selain itu penjelasan bahwa pengeluaran dibatalkan otomatis setelah 7 hari.
 */
export function DispatchSection({ dispatch, canEdit }: DispatchSectionProps) {
  const me = useMe();
  const stack = useStackNavigation();
  const [open, setOpen] = useState(false);
  const status = DISPATCH_STATUS[dispatch.status];
  const hasDraft = draftDispatchId(me.email) === dispatch.id;
  const copy = useCopyDispatch(dispatch.id);

  return (
    <article
      className="space-y-3 rounded-md border p-4"
      aria-label={`Pengeluaran ${dispatch.dispatchedOn}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-medium">
          <Link
            to="/serial/gudang/riwayat/$dispatchId"
            params={{ dispatchId: dispatch.id }}
            className="text-info-text underline-offset-4 hover:underline"
          >
            {dispatch.number}
          </Link>
          <span className="ml-2 font-normal text-muted-foreground">
            {formatDay(dispatch.dispatchedOn)}
          </span>
        </h3>
        <Badge variant="soft" color={status.color}>
          {status.label}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {dispatch.itemLabel} · {dispatch.serialTotal} Serial Number
          {dispatch.createdCount > 0 ? ` (${dispatch.createdCount} dibuat saat keluar)` : ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {dispatch.createdBy} · {formatStamp(dispatch.createdAt)}
      </p>
      {dispatch.note ? <p className="whitespace-pre-wrap text-sm">{dispatch.note}</p> : null}

      {dispatch.status === 'pending' ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Belum selesai: {dispatch.chunksReceived} dari {dispatch.chunkCount} potongan terkirim.
          </p>
          {canEdit && hasDraft ? (
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
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {dispatch.status !== 'cancelled' ? (
          <Button
            type="button"
            variant="ghost"
            color="primary"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            Lihat Serial Number
          </Button>
        ) : null}
        {dispatch.status === 'done' ? (
          <ActionButton
            action="copy"
            label="Salin ulang"
            busy={copy.copying}
            onClick={() => void copy.copyAgain()}
          />
        ) : null}
      </div>
      {open ? <DispatchSerials dispatchId={dispatch.id} /> : null}
      {copy.dialog}
    </article>
  );
}
