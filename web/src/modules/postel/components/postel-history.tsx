import type { AuditEntryDto, AuditSnapshot } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { formatPostelDate } from '../lib/condition';
import { postelHistoryQueryOptions } from '../queries';

interface SnapshotNumber {
  number: string;
  expiresOn: string;
  link: string;
}

/** Snapshot audit Postel: `numbers` = `"<nomor> | <tanggal habis> | <tautan>"` urut `seq`; item/lampiran berupa jumlah. */
interface ParsedSnapshot {
  note: string;
  numbers: SnapshotNumber[];
  items: number | null;
  attachments: number | null;
}

/** `"<nomor> | <tanggal> | <tautan>"`: nomor boleh memuat ' | ', jadi dipecah dari kanan (tautan tanpa spasi). */
const NUMBER_LINE = /^([\s\S]*) \| (\d{4}-\d{2}-\d{2}) \| (\S*)$/;

function parseNumber(raw: unknown): SnapshotNumber | null {
  if (typeof raw !== 'string') return null;
  const match = NUMBER_LINE.exec(raw);
  if (!match) return { number: raw, expiresOn: '', link: '' };
  return { number: match[1] ?? '', expiresOn: match[2] ?? '', link: match[3] ?? '' };
}

function parseSnapshot(snapshot: AuditSnapshot): ParsedSnapshot | null {
  if (snapshot === null) return null;
  const numbers = Array.isArray(snapshot.numbers)
    ? snapshot.numbers.map(parseNumber).filter((entry): entry is SnapshotNumber => entry !== null)
    : [];
  return {
    note: typeof snapshot.note === 'string' ? snapshot.note : '',
    numbers,
    items: typeof snapshot.items === 'number' ? snapshot.items : null,
    attachments: typeof snapshot.attachments === 'number' ? snapshot.attachments : null,
  };
}

function describeNumberChange(before: SnapshotNumber, after: SnapshotNumber): string[] {
  const lines: string[] = [];
  if (before.number !== after.number) lines.push(`Nomor: ${before.number} → ${after.number}`);
  if (before.expiresOn !== after.expiresOn)
    lines.push(
      `Tanggal habis ${after.number}: ${formatPostelDate(before.expiresOn)} → ${formatPostelDate(after.expiresOn)}`,
    );
  if (before.link !== after.link) lines.push(`Tautan ${after.number} diubah`);
  return lines;
}

/**
 * Selisih nomor: dicocokkan menurut nomornya. Nomor yang hilang dan nomor baru yang menempati urutan (`seq`) yang
 * sama dianggap koreksi nomor ("lama → baru"); sisanya "ditambah" atau "dihapus".
 */
function diffNumbers(before: SnapshotNumber[], after: SnapshotNumber[]): string[] {
  const lines: string[] = [];
  const beforeNumbers = new Set(before.map((entry) => entry.number));
  const afterByNumber = new Map(after.map((entry) => [entry.number, entry]));
  const pairedAfter = new Set<number>();
  const removed: string[] = [];
  before.forEach((entry, index) => {
    const match = afterByNumber.get(entry.number);
    if (match) {
      lines.push(...describeNumberChange(entry, match));
      return;
    }
    const replacement = after[index];
    if (replacement && !beforeNumbers.has(replacement.number)) {
      pairedAfter.add(index);
      lines.push(...describeNumberChange(entry, replacement));
    } else removed.push(entry.number);
  });
  after.forEach((entry, index) => {
    if (!beforeNumbers.has(entry.number) && !pairedAfter.has(index))
      lines.push(`Nomor ditambah: ${entry.number} (habis ${formatPostelDate(entry.expiresOn)})`);
  });
  for (const number of removed) lines.push(`Nomor dihapus: ${number}`);
  return lines;
}

/** Ringkasan satu entri: judul ("Dibuat"/"Diubah"/"Dihapus") dan rincian selisih (hanya untuk "Diubah"). */
function summarize(entry: AuditEntryDto): { title: string; details: string[] } {
  if (entry.action === 'postel.create') return { title: 'Dibuat', details: [] };
  if (entry.action === 'postel.delete') return { title: 'Dihapus', details: [] };
  const before = parseSnapshot(entry.before);
  const after = parseSnapshot(entry.after);
  const details: string[] = [];
  if (before && after) {
    details.push(...diffNumbers(before.numbers, after.numbers));
    if (before.note !== after.note) details.push('Catatan diubah');
    if (before.items !== null && after.items !== null && before.items !== after.items)
      details.push(`Item: ${before.items} → ${after.items}`);
    if (
      before.attachments !== null &&
      after.attachments !== null &&
      before.attachments !== after.attachments
    )
      details.push(`Lampiran: ${before.attachments} → ${after.attachments}`);
  }
  return { title: 'Diubah', details };
}

/** Riwayat perubahan satu catatan Postel (20 entri terbaru dari log audit per target). */
export function PostelHistory({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery(postelHistoryQueryOptions(id));
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Riwayat perubahan</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Riwayat tidak dapat dimuat.
        </p>
      ) : !data || data.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
      ) : (
        <>
          <ol className="space-y-3">
            {data.entries.map((entry) => {
              const { title, details } = summarize(entry);
              return (
                <li key={entry.id} className="space-y-0.5 text-sm">
                  <div className="font-medium">{title}</div>
                  <p className="text-xs text-muted-foreground">
                    {formatAuditTime(entry.ts)} · {entry.actor}
                  </p>
                  {details.length > 0 ? (
                    <ul className="list-disc pl-5 break-words">
                      {details.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {data.nextCursor !== null ? (
            <p className="text-xs text-muted-foreground">
              Hanya 20 perubahan terbaru yang ditampilkan.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
