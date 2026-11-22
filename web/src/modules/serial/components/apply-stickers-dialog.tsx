import type { SerialSummaryDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import {
  isDefiniteRejection,
  newPendingApplyStickers,
  type PendingApplyStickers,
  pendingSummary,
} from '../lib/apply-stickers-intent';
import { todayWib } from '../lib/locations';
import { groupSerialsByItemBu, STICKER_ROWS_MAX, type StickerGroup } from '../lib/sticker-groups';
import { serialStickerOptionsQueryOptions, useApplyStickersBatch } from '../queries';
import { RecheckStickerList } from './act-fields';

export interface ApplyStickersDialogProps {
  /** Serial terpilih (potret saat dialog dibuka). */
  rows: readonly SerialSummaryDto[];
  onClose: () => void;
  /**
   * Niat kirim yang hasilnya belum jelas, dipegang halaman daftar (di luar umur dialog). Ada = dialog hanya menawarkan
   * "Kirim ulang" persis sama (id dan isi sama), bukan formulir baru.
   */
  pending: PendingApplyStickers | null;
  onPendingChange: (pending: PendingApplyStickers | null) => void;
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
 * Idempotensi (review akhir 2026-11-22): `clientId` hidup per NIAT KIRIM, di luar dialog dan halaman (store modul per
 * email, lewat `onPendingChange`). Niat dicatat SEBELUM dikirim; sukses atau penolakan pasti (VALIDATION/CONFLICT/
 * FORBIDDEN/NOT_FOUND) menghapusnya, sedangkan kegagalan yang tak jelas (jaringan putus, 5xx) menyimpannya. Mode
 * "Kirim ulang" (kirim PERSIS isi dan id yang sama, formulir diganti ringkasan) HANYA aktif bila niat sudah ada saat dialog
 * dibuka atau kiriman dialog ini baru saja berakhir tak jelas; selama kiriman pertama berjalan formulir tetap tampil
 * (nonaktif). Tanpa Urungkan (stok yang sudah terpotong tak dapat dibalik).
 */
export function ApplyStickersDialog({
  rows,
  onClose,
  pending,
  onPendingChange,
  onDone,
}: ApplyStickersDialogProps) {
  const apply = useApplyStickersBatch();
  const groups = useMemo(() => groupSerialsByItemBu(rows), [rows]);
  const today = todayWib();
  const [occurredOn, setOccurredOn] = useState(today);
  const [message, setMessage] = useState('');
  const [checks, setChecks] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  // Mode "Kirim ulang": niat sudah ada saat dialog dibuka (`resumed`) atau kiriman dialog ini berakhir tak jelas.
  const [resumed, setResumed] = useState(pending !== null);
  const [ambiguous, setAmbiguous] = useState(false);
  const resend = pending !== null && (resumed || ambiguous);

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

  async function send(intent: PendingApplyStickers, previous = false) {
    setError(null);
    try {
      const result = await apply.mutateAsync(intent.input);
      onPendingChange(null);
      toast.success(`${result.ids.length} Serial Number ditempeli stiker`);
      onDone(result.ids);
      onClose();
    } catch (caught) {
      if (isDefiniteRejection(caught)) {
        // Server menolak tanpa menulis apa pun: niat ini selesai, kiriman berikutnya boleh memakai id baru.
        onPendingChange(null);
        setResumed(false);
        setAmbiguous(false);
        const message = describeError(caught);
        if (previous && rows.length === 0) {
          // Tanpa pilihan serial tak ada formulir untuk dicatat: sampaikan penolakannya lalu tutup.
          toast.error(`Kiriman sebelumnya ditolak: ${message}`);
          onClose();
          return;
        }
        setError(previous ? `Kiriman sebelumnya ditolak: ${message}` : message);
      } else {
        // Hasil tak jelas: pertahankan id dan isi; dialog beralih ke mode "Kirim ulang".
        setAmbiguous(true);
        setError(
          `${describeError(caught)} Hasil pengiriman belum jelas; kirim ulang tanpa mengubah isinya.`,
        );
      }
    }
  }

  function submit() {
    const serialNumbers = groups.flatMap((group) =>
      (checks[group.key]?.size ?? 0) > 0 ? group.serials : [],
    );
    const intent = newPendingApplyStickers(
      { occurredOn, message, rows: payloadRows },
      serialNumbers,
    );
    // Dicatat SEBELUM dikirim: bila dialog tertutup atau jawabannya hilang, id dan isi yang sama tetap tersedia.
    onPendingChange(intent);
    return send(intent);
  }

  function discardPending() {
    onPendingChange(null);
    setResumed(false);
    setAmbiguous(false);
    setError(null);
    // Dibuka dari pemberitahuan tanpa pilihan serial: tak ada yang bisa dicatat, jadi tutup (bukan formulir 0 serial).
    if (rows.length === 0) onClose();
  }

  if (pending && resend) {
    const { input } = pending;
    return (
      <Dialog open onOpenChange={(open) => !open && !apply.isPending && onClose()}>
        <DialogContent size="full-on-phone">
          <DialogHeader>
            <DialogTitle>Tempel stiker</DialogTitle>
            <DialogDescription>
              Kiriman sebelumnya (bukan pilihan saat ini) belum jelas hasilnya (koneksi terputus
              atau server tidak menjawab), jadi stok mungkin sudah terpotong. Kirim ulang persis
              sama: server memastikan stok tidak terpotong dua kali.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Tanggal</dt>
              <dd>{input.occurredOn}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Serial Number</dt>
              <dd>{pendingSummary(pending)}</dd>
            </div>
            {input.message ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Catatan</dt>
                <dd className="whitespace-pre-wrap">{input.message}</dd>
              </div>
            ) : null}
          </dl>
          {error ? (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          ) : null}
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
            <Button
              type="button"
              variant="outline"
              color="destructive"
              disabled={apply.isPending}
              onClick={discardPending}
            >
              Buang pengiriman sebelumnya
            </Button>
            <Button
              type="button"
              disabled={apply.isPending}
              onClick={() => void send(pending, true)}
            >
              {apply.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : 'Kirim ulang'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
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
              disabled={apply.isPending}
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
