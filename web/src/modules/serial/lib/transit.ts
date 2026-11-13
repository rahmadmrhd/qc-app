import type { SerialEventDto } from '@shared/contract';

const DAY_MS = 86_400_000;

function utcDay(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Selisih hari kalender `YYYY-MM-DD` (`to` dikurangi `from`, minimal 0); `null` bila salah satunya bukan tanggal. */
export function daysBetweenDates(from: string, to: string): number | null {
  const start = utcDay(from);
  const end = utcDay(to);
  if (start === null || end === null) return null;
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

/** Catatan pengiriman terakhir (kejadian `send` terbaru yang membawanya); `null` bila tidak ada. */
export function lastShipmentNote(events: readonly SerialEventDto[]): string | null {
  const sends = events.filter((event) => event.type === 'send');
  const latest = sends.reduce<SerialEventDto | null>(
    (best, event) => (best === null || event.seq > best.seq ? event : best),
    null,
  );
  const note = latest?.data.shipmentNote;
  return typeof note === 'string' && note.trim() !== '' ? note : null;
}
