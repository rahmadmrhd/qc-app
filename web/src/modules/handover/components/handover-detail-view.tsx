import type { HandoverDto } from '@shared/rpc';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { HANDOVER_STATUS_LABELS, handoverStatusVariant } from '../lib/status';

export interface HandoverDetailViewProps {
  handover: HandoverDto;
  locationName: string;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task. */
  canCancel: boolean;
  /** QC: `qc: edit` di lokasi task. */
  canProgress: boolean;
  /** Tautan ke detail item (hanya untuk user ber-`item: view`); bila tidak ada, label teks biasa. */
  renderItemLink?: (itemId: string, label: string) => ReactNode;
  pending: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSetProgress: (lineId: string, doneQty: number) => void;
  onCompleteLine: (lineId: string) => void;
  onCompleteAll: () => void;
}

function ProgressCell({
  lineId,
  label,
  qty,
  doneQty,
  disabled,
  onSetProgress,
}: {
  lineId: string;
  label: string;
  qty: number;
  doneQty: number;
  disabled: boolean;
  onSetProgress: (lineId: string, doneQty: number) => void;
}) {
  const [text, setText] = useState(String(doneQty));
  const [error, setError] = useState<string | null>(null);
  function commit() {
    const value = Number(text);
    if (text.trim() === '' || !Number.isInteger(value) || value < 0 || value > qty) {
      setError(`Harus bilangan bulat 0–${qty}`);
      return;
    }
    setError(null);
    if (value !== doneQty) onSetProgress(lineId, value);
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={qty}
          className="w-24"
          aria-label={`Qty selesai ${label}`}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <span className="text-sm text-muted-foreground">/ {qty}</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function HandoverDetailView({
  handover,
  locationName,
  canEdit,
  canCancel,
  canProgress,
  renderItemLink,
  pending,
  onBack,
  onEdit,
  onCancel,
  onSetProgress,
  onCompleteLine,
  onCompleteAll,
}: HandoverDetailViewProps) {
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | null>(null);
  const open = handover.status === 'new' || handover.status === 'in_progress';
  const closedMessage =
    handover.status === 'done'
      ? 'Task sudah selesai dan tidak dapat diubah.'
      : handover.status === 'cancelled'
        ? 'Task sudah dibatalkan dan tidak dapat diubah.'
        : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{handover.number}</h1>
            <Badge variant={handoverStatusVariant(handover.status)}>
              {HANDOVER_STATUS_LABELS[handover.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {handover.doneUnits}/{handover.totalUnits} unit
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            Kembali ke daftar
          </Button>
          {open && canEdit ? (
            <Button variant="outline" disabled={pending} onClick={onEdit}>
              Ubah
            </Button>
          ) : null}
          {open && canProgress ? (
            <Button disabled={pending} onClick={() => setConfirm('complete')}>
              Selesaikan semua
            </Button>
          ) : null}
          {open && canCancel ? (
            <Button variant="destructive" disabled={pending} onClick={() => setConfirm('cancel')}>
              Batalkan task
            </Button>
          ) : null}
        </div>
      </div>

      {closedMessage ? (
        <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
          {closedMessage}
        </p>
      ) : null}

      <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-medium">{handover.customerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lokasi</dt>
          <dd className="font-medium">{locationName}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Catatan</dt>
          <dd>{handover.note === '' ? '—' : handover.note}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dibuat</dt>
          <dd>
            {formatAuditTime(handover.createdAt)} oleh {handover.createdBy}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Diperbarui</dt>
          <dd>
            {formatAuditTime(handover.updatedAt)} oleh {handover.updatedBy}
          </dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Tipe dan progres</h2>
        <ul className="divide-y rounded-lg border">
          {handover.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium">
                  {renderItemLink ? renderItemLink(line.itemId, line.itemLabel) : line.itemLabel}
                </div>
                {line.doneAt !== '' ? (
                  <p className="text-xs text-muted-foreground">
                    Diperbarui {formatAuditTime(line.doneAt)} oleh {line.doneBy}
                  </p>
                ) : null}
              </div>
              <div className="flex items-start gap-2">
                {open && canProgress ? (
                  <>
                    <ProgressCell
                      key={`${line.id}-${line.doneQty}`}
                      lineId={line.id}
                      label={line.itemLabel}
                      qty={line.qty}
                      doneQty={line.doneQty}
                      disabled={pending}
                      onSetProgress={onSetProgress}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Selesai ${line.itemLabel}`}
                      disabled={pending || line.doneQty >= line.qty}
                      onClick={() => onCompleteLine(line.id)}
                    >
                      Selesai
                    </Button>
                  </>
                ) : (
                  <span className="text-sm tabular-nums">
                    {line.doneQty} / {line.qty}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => (next ? undefined : setConfirm(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'cancel' ? 'Batalkan task?' : 'Selesaikan semua tipe?'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'cancel'
                ? 'Task dibatalkan dan menjadi baca saja. Progres yang sudah tercatat tetap ada di Log Audit.'
                : 'Semua tipe diisi penuh sesuai target dan task menjadi Selesai. Tindakan ini mencatat nama dan waktu Anda.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Tidak
            </Button>
            <Button
              variant={confirm === 'cancel' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'cancel') onCancel();
                else onCompleteAll();
              }}
            >
              {confirm === 'cancel' ? 'Ya, batalkan' : 'Ya, selesaikan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
