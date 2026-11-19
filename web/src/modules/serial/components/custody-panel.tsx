import type { SerialDto } from '@shared/contract';
import { formatDay } from '../lib/labels';
import { daysBetweenDates } from '../lib/transit';

export interface CustodyPanelProps {
  serial: SerialDto;
  /** Hari ini menurut WIB (`YYYY-MM-DD`). */
  today: string;
}

/** Panel pengiriman yang sedang berjalan (custody `transit`): asal, tujuan, tanggal kirim, dan lama belum diterima. */
export function CustodyPanel({ serial, today }: CustodyPanelProps) {
  if (serial.custody !== 'transit') return null;
  const days = serial.transitOn ? daysBetweenDates(serial.transitOn, today) : null;
  return (
    <section
      aria-label="Pengiriman"
      className="space-y-2 rounded-lg border border-warning-text/35 bg-warning-text/10 p-4"
    >
      <h2 className="text-sm font-semibold">Dalam pengiriman</h2>
      <p className="text-sm">
        <span className="font-medium">{serial.transitFromLocationName ?? serial.locationName}</span>
        {' → '}
        <span className="font-medium">{serial.transitToLocationName ?? '—'}</span>
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Tanggal kirim</dt>
          <dd>{serial.transitOn ? formatDay(serial.transitOn) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Lama</dt>
          <dd>
            {days === null
              ? '—'
              : days === 0
                ? 'Dikirim hari ini, belum diterima'
                : `${days} hari belum diterima`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
