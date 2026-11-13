import type { SerialActInput, SerialDto, SerialStickerPick } from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { availableActions } from '@shared/serial-flow';
import { SERIAL_LIMITS, type SerialAction } from '@shared/serials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FieldError } from '@/components/field-error';
import { Select } from '@/components/select';
import { BusyLabel } from '@/components/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { serialActorModules } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { serialKeys } from '../keys';
import { flowRowLabel } from '../lib/labels';
import { todayWib } from '../lib/locations';
import { serialStickerOptionsQueryOptions, useActSerial } from '../queries';
import { DamageField, SendFields, StickerQtyList, type StickerRow } from './act-fields';
import { SerialLocationField } from './serial-location-field';

export interface ActComposerProps {
  serial: SerialDto;
}

const STALE_RELOAD_MESSAGE = `${STALE_SAVE_MESSAGE}. Halaman sudah dimuat ulang. Pesan Anda tetap ada, tapi lokasi dan jumlah stiker kembali ke data terbaru. Atur lagi kalau perlu, lalu kirim ulang.`;

/** Field input yang galat servernya tampil di bawah field-nya sendiri. */
type FieldKey =
  | 'damage'
  | 'toLocationId'
  | 'shipmentNote'
  | 'occurredOn'
  | 'locationId'
  | 'stickers'
  | 'message';
type FieldErrors = Partial<Record<FieldKey, string>>;

const RESULT_OPTIONS = [
  { value: 'pass', label: 'Lolos' },
  { value: 'fail', label: 'Tidak lolos' },
];

function qtyOf(serial: SerialDto): Map<string, number> {
  return new Map(serial.stickers.map((sticker) => [sticker.stickerId, sticker.qty]));
}

/** Kerusakan kasus terbuka jadi isian awal pada aksi yang memperbarui kerusakan. */
const PREFILL_DAMAGE = new Set(['identify_damage', 'service_diagnosis', 'recheck_fail']);

/**
 * Pisahkan galat server: field yang kolomnya sedang tampil (`visible`) muncul di kolomnya, sisanya di pesan umum
 * (jalur galat yang sama dengan aksi lain).
 */
function splitError(
  caught: unknown,
  visible: readonly FieldKey[],
): { fields: FieldErrors; general: string | null } {
  if (caught instanceof ApiError && caught.fields) {
    const fields: FieldErrors = {};
    const rest: Record<string, string> = {};
    for (const [key, value] of Object.entries(caught.fields)) {
      if ((visible as readonly string[]).includes(key)) fields[key as FieldKey] = value;
      else rest[key] = value;
    }
    if (Object.keys(fields).length > 0) {
      const general =
        Object.keys(rest).length > 0
          ? describeError(new ApiError(caught.code, caught.message, caught.requestId, rest))
          : null;
      return { fields, general };
    }
  }
  return { fields: {}, general: describeError(caught) };
}

/**
 * Kotak "Update baru": aksi yang tersedia mengikuti tabel transisi (`availableActions` menurut status, posisi, dan modul
 * izin pengguna di BU serial itu), lengkap dengan kolom tiap aksi: kerusakan, tujuan dan catatan pengiriman, hasil cek
 * ulang, lokasi dan stiker, serta pesan Markdown (dengan gambar). Tanpa aksi tersedia, kotak ini tidak tampil.
 */
export function ActComposer({ serial }: ActComposerProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const act = useActSerial();
  const actor = serialActorModules(me, serial.buId);
  const flowRows = availableActions({ status: serial.status, custody: serial.custody }, actor);
  const [selected, setSelected] = useState('note');
  const [message, setMessage] = useState('');
  const [occurredOn, setOccurredOn] = useState(() => todayWib());
  const [damage, setDamage] = useState<string | null>(null);
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  const [toLocation, setToLocation] = useState({ id: '', label: '' });
  const [shipmentNote, setShipmentNote] = useState('');
  const [location, setLocation] = useState({ id: serial.locationId, label: serial.locationName });
  const [qty, setQty] = useState(() => qtyOf(serial));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const today = todayWib();

  // Serial berubah (disimpan di sini atau dimuat ulang): lokasi dan jumlah stiker mengikuti nilai terbaru.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya pada perubahan versi serial
  useEffect(() => {
    setLocation({ id: serial.locationId, label: serial.locationName });
    setQty(qtyOf(serial));
  }, [serial.updatedAt]);

  const row =
    flowRows.find((entry) => entry.action === selected) ??
    flowRows.find((entry) => entry.action === 'note') ??
    flowRows[0];
  const maybeAction = row?.action;
  const allowStickers = row?.allowStickers === true;
  const options = useQuery({
    ...serialStickerOptionsQueryOptions(serial.itemId, serial.buId),
    enabled: allowStickers,
  });
  if (!row || !maybeAction) return null;
  const action: SerialAction = maybeAction;

  const base = qtyOf(serial);
  const stickerRows: StickerRow[] = [
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

  function step(entry: StickerRow, delta: number) {
    if (entry.inactive && delta > 0) return;
    const next = new Map(qty);
    const current = next.get(entry.stickerId) ?? entry.base;
    next.set(
      entry.stickerId,
      Math.min(SERIAL_LIMITS.stickerQtyMax, Math.max(entry.base, current + delta)),
    );
    setQty(next);
  }

  const failedRecheck = action === 'recheck' && result === 'fail';
  const damageRequired = row.required.includes('damage') || failedRecheck;
  const showDamage = damageRequired || action === 'recheck_fail';
  const damageText = damage ?? (PREFILL_DAMAGE.has(action) ? (serial.openCase?.damage ?? '') : '');
  const damageValue = damageText.trim();
  const tooManyImages = extractFileRefs(message).length > SERIAL_LIMITS.messageImagesMax;
  const receiveTooEarly =
    action === 'receive' && serial.transitOn !== null && occurredOn < serial.transitOn;
  const sameLocation =
    action === 'send' && toLocation.id !== '' && toLocation.id === serial.locationId;
  const clientErrors: FieldErrors = {
    ...(tooManyImages
      ? { message: `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per pesan` }
      : {}),
    ...(receiveTooEarly ? { occurredOn: 'Tanggal terima tidak boleh sebelum tanggal kirim' } : {}),
    ...(sameLocation ? { toLocationId: 'Lokasi tujuan harus beda dengan lokasi sekarang' } : {}),
  };
  const errorOf = (key: FieldKey) => clientErrors[key] ?? fieldErrors[key];

  const submitDisabled =
    act.isPending ||
    (action === 'note' && message.trim() === '') ||
    occurredOn === '' ||
    occurredOn > today ||
    (damageRequired && damageValue === '') ||
    (action === 'send' && toLocation.id === '') ||
    Object.keys(clientErrors).length > 0;

  function buildInput(): SerialActInput {
    const common = {
      id: serial.id,
      expectedUpdatedAt: serial.updatedAt,
      occurredOn,
      message,
    };
    const raised: SerialStickerPick[] = stickerRows.flatMap((entry) => {
      const value = qty.get(entry.stickerId) ?? entry.base;
      return value > entry.base ? [{ stickerId: entry.stickerId, qty: value }] : [];
    });
    const check = {
      ...(location.id !== '' ? { locationId: location.id } : {}),
      ...(raised.length > 0 ? { stickers: raised } : {}),
    };
    switch (action) {
      case 'report_failure':
      case 'identify_damage':
      case 'service_diagnosis':
        return { ...common, action, damage: damageValue };
      case 'send':
        return {
          ...common,
          action,
          toLocationId: toLocation.id,
          shipmentNote: shipmentNote.trim(),
        };
      case 'recheck':
        return {
          ...common,
          action,
          ...(failedRecheck ? { result: 'fail' as const, damage: damageValue } : {}),
          ...check,
        };
      case 'recheck_pass':
        return { ...common, action, ...check };
      case 'recheck_fail':
        return {
          ...common,
          action,
          ...(damageValue !== '' ? { damage: damageValue } : {}),
          ...check,
        };
      default:
        return { ...common, action };
    }
  }

  /**
   * Mengosongkan isian khusus aksi; lokasi dan jumlah stiker kembali ke nilai serial saat ini. Pesan (dan gambar yang
   * sudah diunggah) dikosongkan hanya setelah sukses (`withMessage`), bukan saat ganti aksi.
   */
  function resetFields(withMessage: boolean) {
    if (withMessage) setMessage('');
    setDamage(null);
    setShipmentNote('');
    setToLocation({ id: '', label: '' });
    setResult('pass');
    setLocation({ id: serial.locationId, label: serial.locationName });
    setQty(qtyOf(serial));
    setError(null);
    setFieldErrors({});
  }

  async function submit() {
    setError(null);
    setFieldErrors({});
    try {
      await act.mutateAsync(buildInput());
      // Kembali ke Catatan (aksi netral); pilihan tidak melompat ke aksi lain setelah status berubah.
      resetFields(true);
      setSelected('note');
    } catch (caught) {
      if (isStaleSaveError(caught)) {
        setError(STALE_RELOAD_MESSAGE);
        // Kepala DAN riwayat dimuat ulang: entri orang lain yang membuat versi usang harus terlihat.
        void queryClient.invalidateQueries({ queryKey: serialKeys.one(serial.id) });
        void queryClient.invalidateQueries({ queryKey: serialKeys.history(serial.id) });
        return;
      }
      const visible: FieldKey[] = ['occurredOn', 'message'];
      if (showDamage) visible.push('damage');
      if (action === 'send') visible.push('toLocationId', 'shipmentNote');
      if (allowStickers) visible.push('locationId');
      if (allowStickers && stickerRows.length > 0) visible.push('stickers');
      const split = splitError(caught, visible);
      setFieldErrors(split.fields);
      setError(split.general);
    }
  }

  const submitLabel =
    action === 'note'
      ? 'Kirim catatan'
      : action === 'recheck'
        ? 'Simpan cek ulang'
        : flowRowLabel(row);

  return (
    <section aria-label="Update baru" className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Update baru</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="act-action"
          label="Jenis update"
          value={action}
          options={flowRows.map((entry) => ({ value: entry.action, label: flowRowLabel(entry) }))}
          onValueChange={(next) => {
            setSelected(next);
            resetFields(false);
          }}
        />
        <div className="space-y-1.5">
          <Label htmlFor="act-date">Tanggal</Label>
          <Input
            id="act-date"
            type="date"
            max={today}
            {...(action === 'receive' && serial.transitOn ? { min: serial.transitOn } : {})}
            value={occurredOn}
            aria-invalid={errorOf('occurredOn') ? true : undefined}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
          <FieldError errors={[errorOf('occurredOn')]} />
        </div>
      </div>
      {action === 'recheck' ? (
        <Select
          id="act-result"
          label="Hasil cek ulang"
          className="sm:w-1/2"
          value={result}
          options={RESULT_OPTIONS}
          onValueChange={(next) => setResult(next === 'fail' ? 'fail' : 'pass')}
        />
      ) : null}
      {showDamage ? (
        <DamageField
          id="act-damage"
          value={damageText}
          onChange={setDamage}
          required={damageRequired}
          error={errorOf('damage')}
          disabled={act.isPending}
        />
      ) : null}
      {action === 'send' ? (
        <SendFields
          location={toLocation}
          onLocationChange={(id, label) => setToLocation({ id, label })}
          shipmentNote={shipmentNote}
          onShipmentNoteChange={setShipmentNote}
          locationError={errorOf('toLocationId')}
          noteError={errorOf('shipmentNote')}
          disabled={act.isPending}
        />
      ) : null}
      {action === 'receive' ? (
        <p className="text-sm">
          Diterima di{' '}
          <span className="font-medium">{serial.transitToLocationName ?? serial.locationName}</span>
          . Lokasi Serial Number pindah ke sana setelah diterima.
        </p>
      ) : null}
      {allowStickers ? (
        <div className="space-y-3">
          <SerialLocationField
            id="act-location"
            label="Lokasi cek ulang"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
            error={errorOf('locationId')}
          />
          <StickerQtyList rows={stickerRows} qty={qty} onStep={step} error={errorOf('stickers')} />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label id="act-message-label">{action === 'note' ? 'Catatan' : 'Catatan (opsional)'}</Label>
        <WysiwygEditor
          id="act-message"
          labelledBy="act-message-label"
          mode="message"
          value={message}
          onChange={setMessage}
          maxLength={SERIAL_LIMITS.messageMax}
          maxImages={SERIAL_LIMITS.messageImagesMax}
          disabled={act.isPending}
        />
        <FieldError errors={[errorOf('message')]} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant={action === 'declare_broken' ? 'destructive' : 'default'}
        disabled={submitDisabled}
        onClick={() => (action === 'declare_broken' ? setConfirming(true) : void submit())}
      >
        {act.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : submitLabel}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nyatakan Serial Number ini rusak?</AlertDialogTitle>
            <AlertDialogDescription>
              Serial Number ini akan ditandai rusak dan email dikirim ke penerima. Status rusak
              bersifat final dan tidak bisa dibuka lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void submit();
              }}
            >
              Ya, nyatakan rusak
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
