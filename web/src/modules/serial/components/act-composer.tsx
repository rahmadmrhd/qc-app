import type { SerialDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Select } from '@/components/select';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { serialKeys } from '../keys';
import { todayWib } from '../lib/locations';
import { serialStickerOptionsQueryOptions, useActSerial } from '../queries';
import { SerialLocationField } from './serial-location-field';

export interface ActComposerProps {
  serial: SerialDto;
}

interface StickerRow {
  stickerId: string;
  name: string;
  /** Jumlah tersimpan (batas bawah: tidak dapat diturunkan); 0 = stiker belum ditempel. */
  base: number;
  /** Stiker nonaktif: jumlahnya tidak dapat dinaikkan (server menolak); `deprecated` tetap boleh. */
  inactive: boolean;
}

const STALE_RELOAD_MESSAGE = `${STALE_SAVE_MESSAGE}. Halaman sudah dimuat ulang. Pesan Anda tetap ada, tapi lokasi dan jumlah stiker kembali ke data terbaru. Atur lagi kalau perlu, lalu kirim ulang.`;

function qtyOf(serial: SerialDto): Map<string, number> {
  return new Map(serial.stickers.map((sticker) => [sticker.stickerId, sticker.qty]));
}

/**
 * Kotak "Pembaruan baru": catatan atau cek ulang (hanya serial Lolos yang berada di QC). Cek ulang dapat memindahkan
 * lokasi dan menaikkan jumlah stiker (tidak dapat diturunkan di bawah jumlah sekarang).
 */
export function ActComposer({ serial }: ActComposerProps) {
  const queryClient = useQueryClient();
  const act = useActSerial();
  const canRecheck = serial.status === 'good' && serial.custody === 'qc';
  const [action, setAction] = useState<'note' | 'recheck'>('note');
  const [message, setMessage] = useState('');
  const [occurredOn, setOccurredOn] = useState(() => todayWib());
  const [location, setLocation] = useState({ id: serial.locationId, label: serial.locationName });
  const [qty, setQty] = useState(() => qtyOf(serial));
  const [error, setError] = useState<string | null>(null);
  const today = todayWib();

  // Serial berubah (disimpan di sini atau dimuat ulang): lokasi dan jumlah stiker mengikuti nilai terbaru.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya pada perubahan versi serial
  useEffect(() => {
    setLocation({ id: serial.locationId, label: serial.locationName });
    setQty(qtyOf(serial));
  }, [serial.updatedAt]);

  const effectiveAction = canRecheck ? action : 'note';
  const options = useQuery({
    ...serialStickerOptionsQueryOptions(serial.itemId, serial.buId),
    enabled: effectiveAction === 'recheck',
  });
  const base = qtyOf(serial);
  const rows: StickerRow[] = [
    ...serial.stickers.map((sticker) => ({
      stickerId: sticker.stickerId,
      name: sticker.name,
      base: sticker.qty,
      inactive: sticker.stickerStatus === 'inactive',
    })),
    ...(options.data?.stickers ?? [])
      .filter((sticker) => !base.has(sticker.id))
      .map((sticker) => ({ stickerId: sticker.id, name: sticker.name, base: 0, inactive: false })),
  ];

  function step(row: StickerRow, delta: number) {
    if (row.inactive && delta > 0) return;
    const next = new Map(qty);
    const current = next.get(row.stickerId) ?? row.base;
    next.set(
      row.stickerId,
      Math.min(SERIAL_LIMITS.stickerQtyMax, Math.max(row.base, current + delta)),
    );
    setQty(next);
  }

  const messageBlank = message.trim() === '';
  const submitDisabled =
    act.isPending ||
    (effectiveAction === 'note' && messageBlank) ||
    occurredOn === '' ||
    occurredOn > today;

  async function submit() {
    setError(null);
    const raised = rows.flatMap((row) => {
      const value = qty.get(row.stickerId) ?? row.base;
      return value > row.base ? [{ stickerId: row.stickerId, qty: value }] : [];
    });
    try {
      await act.mutateAsync({
        id: serial.id,
        expectedUpdatedAt: serial.updatedAt,
        action: effectiveAction,
        occurredOn,
        message,
        ...(effectiveAction === 'recheck'
          ? {
              ...(location.id !== '' ? { locationId: location.id } : {}),
              ...(raised.length > 0 ? { stickers: raised } : {}),
            }
          : {}),
      });
      setMessage('');
    } catch (caught) {
      if (isStaleSaveError(caught)) {
        setError(STALE_RELOAD_MESSAGE);
        void queryClient.invalidateQueries({ queryKey: serialKeys.one(serial.id) });
      } else {
        setError(describeError(caught));
      }
    }
  }

  return (
    <section aria-label="Update baru" className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Update baru</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="act-action"
          label="Jenis update"
          value={effectiveAction}
          options={[
            { value: 'note', label: 'Catatan' },
            ...(canRecheck ? [{ value: 'recheck', label: 'Cek ulang' }] : []),
          ]}
          onValueChange={(next) => setAction(next === 'recheck' ? 'recheck' : 'note')}
        />
        <div className="space-y-1.5">
          <Label htmlFor="act-date">Tanggal kejadian</Label>
          <Input
            id="act-date"
            type="date"
            max={today}
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </div>
      </div>
      {effectiveAction === 'recheck' ? (
        <div className="space-y-3">
          <SerialLocationField
            id="act-location"
            label="Lokasi cek ulang"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
          />
          {rows.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Stiker (jumlah tidak bisa dikurangi)</legend>
              <ul className="space-y-2">
                {rows.map((row) => {
                  const value = qty.get(row.stickerId) ?? row.base;
                  return (
                    <li key={row.stickerId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate">{row.name}</span>
                        {row.inactive ? (
                          <span className="block text-xs text-muted-foreground">
                            Stiker nonaktif: jumlah tidak bisa ditambah
                          </span>
                        ) : null}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Kurangi ${row.name}`}
                          disabled={value <= row.base}
                          onClick={() => step(row, -1)}
                        >
                          <Minus aria-hidden />
                        </Button>
                        <output
                          aria-label={`Jumlah ${row.name}`}
                          className="w-6 text-center text-sm tabular-nums"
                        >
                          {value}
                        </output>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Tambah ${row.name}`}
                          disabled={row.inactive || value >= SERIAL_LIMITS.stickerQtyMax}
                          onClick={() => step(row, 1)}
                        >
                          <Plus aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label id="act-message-label">
          {effectiveAction === 'note' ? 'Catatan' : 'Catatan cek ulang (opsional)'}
        </Label>
        <WysiwygEditor
          id="act-message"
          labelledBy="act-message-label"
          mode="message"
          value={message}
          onChange={setMessage}
          maxLength={SERIAL_LIMITS.messageMax}
          disabled={act.isPending}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" disabled={submitDisabled} onClick={() => void submit()}>
        {act.isPending ? (
          <BusyLabel>Menyimpan…</BusyLabel>
        ) : effectiveAction === 'recheck' ? (
          'Simpan cek ulang'
        ) : (
          'Kirim catatan'
        )}
      </Button>
    </section>
  );
}
