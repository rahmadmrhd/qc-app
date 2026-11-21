import type { SerialLookupMatchDto } from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { SERIAL_LIMITS } from '@shared/serials';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { serialKeys } from '../keys';
import { STATUS_LABEL } from '../lib/labels';
import { todayWib, toLocationOptions } from '../lib/locations';
import { useSerialLocations } from '../lib/use-serial-locations';
import { useActSerial, useReportNewSerial } from '../queries';
import { MessageField } from './act-fields';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';

/** Field yang galat servernya tampil di bawah field-nya; sisanya pesan umum. */
function fieldError(caught: unknown, key: string): string | undefined {
  return caught instanceof ApiError ? caught.fields?.[key] : undefined;
}

/** Pesan umum: galat yang seluruhnya milik field yang tampil tidak diulang di bawah. */
function generalMessage(caught: unknown, shown: readonly string[]): string | null {
  if (caught instanceof ApiError && caught.fields) {
    const rest = Object.keys(caught.fields).filter((key) => !shown.includes(key));
    if (rest.length === 0) return null;
  }
  return describeError(caught);
}

export interface ExistingReportFormProps {
  match: SerialLookupMatchDto;
  /** Laporan terbuka: pindah ke detail serial itu. */
  onDone: (serialId: string) => void;
}

/** Serial sudah tercatat dan Lolos: ringkasan unit + catatan wajib, lalu membuka laporan (`serials.act` `report_failure`). */
export function ExistingReportForm({ match, onDone }: ExistingReportFormProps) {
  const queryClient = useQueryClient();
  const act = useActSerial();
  const [message, setMessage] = useState('');
  // Gambar catatan yang masih diunggah: tombol lapor ditahan agar gambarnya tidak tertinggal.
  const [messageBusy, setMessageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | undefined>();
  const tooManyImages = extractFileRefs(message).length > SERIAL_LIMITS.messageImagesMax;

  async function submit() {
    setError(null);
    setMessageError(undefined);
    try {
      const saved = await act.mutateAsync({
        id: match.id,
        expectedUpdatedAt: match.updatedAt,
        occurredOn: todayWib(),
        message,
        action: 'report_failure',
      });
      toast.success(`Laporan dibuka untuk ${saved.serial}`);
      onDone(saved.id);
    } catch (caught) {
      setMessageError(fieldError(caught, 'message'));
      setError(generalMessage(caught, ['message']));
      // Serial berubah (atau laporan aktif muncul) sejak dicari: data pencarian dimuat ulang agar status terbaru tampil.
      if (caught instanceof ApiError && caught.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: [...serialKeys.all, 'lookup'] });
      }
    }
  }

  return (
    <section
      aria-label="Laporkan Serial Number"
      className="space-y-4 rounded-lg border p-4"
      data-tour="report-result"
    >
      <UnitSummary match={match} />
      <div data-tour="report-message">
        <MessageField
          id="report-message"
          required
          value={message}
          onChange={setMessage}
          error={
            tooManyImages
              ? `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per catatan`
              : messageError
          }
          disabled={act.isPending}
          onBusyChange={setMessageBusy}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        data-tour="report-submit"
        disabled={act.isPending || messageBusy || message.trim() === '' || tooManyImages}
        onClick={() => void submit()}
      >
        {act.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : 'Lapor rusak'}
      </Button>
    </section>
  );
}

/** Ringkasan unit yang ditemukan (kartu pada halaman Lapor Rusak). */
export function UnitSummary({ match }: { match: SerialLookupMatchDto }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="text-xs text-muted-foreground">Serial Number</dt>
        <dd className="font-mono text-sm">{match.serial}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Item</dt>
        <dd className="text-sm">{match.itemLabel}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Business Unit</dt>
        <dd className="text-sm">{match.buCode}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Status dan lokasi</dt>
        <dd className="text-sm">
          {STATUS_LABEL[match.status]} · {match.locationName}
        </dd>
      </div>
    </dl>
  );
}

export interface NewReportFormProps {
  /** Serial yang dicari dan belum tercatat (sudah ternormalisasi). */
  serial: string;
  onDone: (serialId: string) => void;
}

/**
 * Serial belum tercatat: item, BU, lokasi, dan catatan wajib; serial dibuat langsung berstatus Dilaporkan
 * dan laporannya terbuka (`serials.reportNew`). Tanggal uji = hari ini (WIB).
 */
export function NewReportForm({ serial, onDone }: NewReportFormProps) {
  const queryClient = useQueryClient();
  const report = useReportNewSerial();
  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [location, setLocation] = useState({ id: '', label: '' });
  const [message, setMessage] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const tooManyImages = extractFileRefs(message).length > SERIAL_LIMITS.messageImagesMax;

  // Hanya satu lokasi yang dapat dipilih: jadi bawaan, sekali saja.
  const { locations } = useSerialLocations();
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || locations.length === 0) return;
    decided.current = true;
    const [only] = toLocationOptions(locations);
    if (only && locations.length === 1) {
      setLocation((current) => (current.id === '' ? { id: only.id, label: only.label } : current));
    }
  }, [locations]);

  const ready =
    item.itemId !== '' &&
    item.buId !== '' &&
    location.id !== '' &&
    message.trim() !== '' &&
    !tooManyImages;

  async function submit() {
    setError(null);
    setFields({});
    try {
      const saved = await report.mutateAsync({
        serial,
        itemId: item.itemId,
        buId: item.buId,
        locationId: location.id,
        message,
        occurredOn: todayWib(),
      });
      toast.success(`Serial Number ${saved.serial} dilaporkan rusak`);
      onDone(saved.id);
    } catch (caught) {
      const shown = ['itemId', 'buId', 'locationId', 'message'];
      setFields(caught instanceof ApiError && caught.fields ? caught.fields : {});
      setError(generalMessage(caught, shown));
      // Serial ternyata sudah terdaftar (dicatat orang lain sejak dicari): pencarian diulang.
      if (caught instanceof ApiError && caught.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: [...serialKeys.all, 'lookup'] });
      }
    }
  }

  return (
    <section
      aria-label="Serial Number belum tercatat"
      className="space-y-4 rounded-lg border p-4"
      data-tour="report-result"
    >
      <p className="text-sm">
        Serial Number <span className="font-mono font-medium">{serial}</span> belum tercatat. Isi
        item, BU, dan lokasinya, lalu laporkan. Serial Number akan dicatat langsung sebagai
        Dilaporkan.
      </p>
      <div className="grid gap-4 sm:grid-cols-2" data-tour="report-new-fields">
        <ItemBuField
          idPrefix="report"
          label="Item"
          buFieldLabel="Business Unit"
          required
          value={item}
          onChange={setItem}
          error={fields.itemId}
          buError={fields.buId}
          disabled={report.isPending}
        />
        <div className="space-y-1.5">
          <SerialLocationField
            id="report-location"
            required
            label="Lokasi"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
            error={fields.locationId}
            disabled={report.isPending}
          />
        </div>
      </div>
      <div data-tour="report-message">
        <MessageField
          id="report-message"
          required
          value={message}
          onChange={setMessage}
          error={
            tooManyImages
              ? `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per catatan`
              : fields.message
          }
          disabled={report.isPending}
          onBusyChange={setMessageBusy}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        data-tour="report-submit"
        disabled={report.isPending || messageBusy || !ready}
        onClick={() => void submit()}
      >
        {report.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : 'Lapor rusak'}
      </Button>
    </section>
  );
}
