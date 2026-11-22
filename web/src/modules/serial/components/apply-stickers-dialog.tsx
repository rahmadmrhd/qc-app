import type { SerialSummaryDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/field-error';
import { BusyLabel } from '@/components/spinner';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { describeError } from '@/lib/api/describe-error';
import { todayWib } from '../lib/locations';
import { groupSerialsByItemBu, STICKER_ROWS_MAX, type StickerGroup } from '../lib/sticker-groups';
import { serialStickerOptionsQueryOptions, useApplyStickersBatch } from '../queries';
import { RecheckStickerList } from './act-fields';

export interface ApplyStickersDialogProps {
  /** Serial terpilih (potret saat dialog dibuka). */
  rows: readonly SerialSummaryDto[];
  onClose: () => void;
  /** Id serial yang berhasil ditempeli, untuk membuang pilihan di daftar. */
  onDone: (ids: string[]) => void;
}

/** "ABC, DEF, GHI dan 4 lainnya": cuplikan nomor serial satu kelompok. */
function serialSample(serials: readonly string[]): string {
  const shown = serials.slice(0, 3).join(', ');
  const more = serials.length - 3;
  return more > 0 ? `${shown} dan ${more} lainnya` : shown;
}

/** Satu kelompok (Item + BU): daftar centang stiker yang berlaku, dimuat dari server dengan salah satu serial kelompok. */
function GroupSection({
  group,
  checked,
  disabled,
  onToggle,
}: {
  group: StickerGroup;
  checked: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (stickerId: string, on: boolean) => void;
}) {
  const options = useQuery(
    serialStickerOptionsQueryOptions(group.itemId, group.buId, group.ids[0]),
  );
  const stickers = options.data?.stickers ?? [];
  return (
    <section
      aria-label={`${group.itemLabel} · ${group.buCode}`}
      className="space-y-2 rounded-lg border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">
          {group.itemLabel} · {group.buCode}
        </h3>
        <p className="text-xs text-muted-foreground">
          {group.ids.length} Serial Number: {serialSample(group.serials)}
        </p>
      </div>
      {options.isPending ? (
        <p className="text-sm text-muted-foreground">Memuat stiker…</p>
      ) : options.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {describeError(options.error)}
        </p>
      ) : stickers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada stiker yang berlaku bagi item ini; kelompok ini dilewati.
        </p>
      ) : (
        <RecheckStickerList
          rows={stickers.map((sticker) => ({
            stickerId: sticker.id,
            name: sticker.name,
            qty: 0,
            inactive: false,
            hint: '',
          }))}
          checked={checked}
          legend="Stiker yang ditempel"
          description="Tiap centang menambah satu stiker pada setiap Serial Number di kelompok ini."
          idPrefix={`bulk-sticker-${group.key.replace(/\W/g, '')}`}
          disabled={disabled}
          onToggle={onToggle}
        />
      )}
    </section>
  );
}

/**
 * Tempel stiker massal dari daftar Serial Number (keputusan pemilik 2026-11-22, K1/K2): serial terpilih dikelompokkan
 * menurut (Item, BU) dan tiap kelompok punya daftar centang sendiri (stiker yang berlaku bagi item itu pada BU itu);
 * kelompok tanpa centang dilewati. Tiap centang = +1 stiker dan potong stok 1 di lokasi masing-masing serial. Satu
 * pengiriman atomik (`serials.applyStickersBatch`: satu serial ditolak = semuanya batal, pesan menyebut nomornya).
 * `clientId` dibuat SEKALI per isi kiriman dan dipakai ulang saat mengulang kiriman yang sama (kunci idempoten server);
 * isi berubah = id baru. Tanpa Urungkan (stok yang sudah terpotong tak dapat dibalik).
 */
export function ApplyStickersDialog({ rows, onClose, onDone }: ApplyStickersDialogProps) {
  const apply = useApplyStickersBatch();
  const groups = useMemo(() => groupSerialsByItemBu(rows), [rows]);
  const today = todayWib();
  const [occurredOn, setOccurredOn] = useState(today);
  const [message, setMessage] = useState('');
  const [checks, setChecks] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const clientIdRef = useRef<{ signature: string; id: string } | null>(null);

  const payloadRows = groups.flatMap((group) => {
    const stickerIds = [...(checks[group.key] ?? [])];
    return stickerIds.length === 0 ? [] : group.ids.map((id) => ({ id, stickerIds }));
  });
  const tooMany = payloadRows.length > STICKER_ROWS_MAX;
  const dateError = occurredOn > today ? 'Tanggal tidak boleh di masa depan' : undefined;
  const messageTooLong = message.length > SERIAL_LIMITS.messageMax;
  const submitDisabled =
    apply.isPending ||
    payloadRows.length === 0 ||
    tooMany ||
    occurredOn === '' ||
    dateError !== undefined ||
    messageTooLong;

  function toggle(key: string, stickerId: string, on: boolean) {
    setChecks((current) => {
      const next = new Set(current[key] ?? []);
      if (on) next.add(stickerId);
      else next.delete(stickerId);
      return { ...current, [key]: next };
    });
  }

  async function submit() {
    setError(null);
    const signature = JSON.stringify({ occurredOn, message, rows: payloadRows });
    // Isi kiriman sama dengan percobaan sebelumnya = kirim ulang (id yang sama); isi berubah = niat kirim baru.
    if (clientIdRef.current?.signature !== signature) {
      clientIdRef.current = { signature, id: crypto.randomUUID() };
    }
    try {
      const result = await apply.mutateAsync({
        clientId: clientIdRef.current.id,
        occurredOn,
        message,
        rows: payloadRows,
      });
      toast.success(`${result.ids.length} Serial Number ditempeli stiker`);
      onDone(result.ids);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !apply.isPending && onClose()}>
      <DialogContent size="full-on-phone">
        <DialogHeader>
          <DialogTitle>Tempel stiker</DialogTitle>
          <DialogDescription>
            Catat stiker yang baru ditempel pada {rows.length} Serial Number. Tiap centang menambah
            satu stiker dan memotong stok satu di lokasi masing-masing serial.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-sticker-date" required>
              Tanggal
            </Label>
            <Input
              id="bulk-sticker-date"
              aria-required="true"
              type="date"
              max={today}
              value={occurredOn}
              aria-invalid={dateError ? true : undefined}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
            <FieldError errors={[dateError]} />
          </div>
          {groups.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              Serial terpilih punya {groups.length} kombinasi Item dan BU, jadi stikernya dipilih
              per kelompok. Kelompok tanpa centang dilewati.
            </p>
          ) : null}
          <div className="space-y-3">
            {groups.map((group) => (
              <GroupSection
                key={group.key}
                group={group}
                checked={checks[group.key] ?? new Set()}
                disabled={apply.isPending}
                onToggle={(stickerId, on) => toggle(group.key, stickerId, on)}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-sticker-message">Catatan (opsional)</Label>
            <Textarea
              id="bulk-sticker-message"
              value={message}
              maxLength={SERIAL_LIMITS.messageMax}
              disabled={apply.isPending}
              placeholder="Dicatat di riwayat tiap Serial Number"
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          {tooMany ? (
            <p role="alert" className="text-sm text-destructive-text">
              Paling banyak {STICKER_ROWS_MAX} Serial Number per pengiriman; hilangkan centang pada
              sebagian kelompok atau kurangi pilihan.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="primary"
            disabled={apply.isPending}
            onClick={onClose}
          >
            Batal
          </Button>
          <Button type="button" disabled={submitDisabled} onClick={() => void submit()}>
            {apply.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : 'Tempel stiker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
