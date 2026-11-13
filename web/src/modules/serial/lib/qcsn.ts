import {
  parseQcsn,
  QCSN_FORMAT,
  QCSN_VERSION,
  type QcsnProblem,
  type QcsnRow,
  qcsnCanonical,
} from '@shared/serial-file';
import type { StagingRow } from './draft';

export const QCSN_EXTENSION = '.qcsn';

function toQcsnRow(row: StagingRow): QcsnRow {
  return {
    clientId: row.clientId,
    serial: row.serial,
    testDate: row.testDate,
    itemId: row.itemId,
    itemLabel: row.itemLabel,
    buId: row.buId,
    buLabel: row.buLabel,
    locationId: row.locationId,
    locationLabel: row.locationLabel,
    sample: row.sample,
    note: row.note,
    status: row.status,
    ...(row.status === 'failed' ? { damage: row.damage.trim() } : {}),
    source: row.source,
    capturedAt: row.capturedAt,
    ...(row.stickers !== null
      ? {
          stickers: row.stickers.map((sticker) => ({
            stickerId: sticker.stickerId,
            stickerLabel: sticker.name,
            qty: sticker.qty,
          })),
        }
      : {}),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function checksumOf(rows: readonly QcsnRow[]): Promise<string> {
  return `sha256:${await sha256Hex(qcsnCanonical(rows))}`;
}

/** Baris yang lolos validator berkas (lengkap: item, lokasi, serial sah); sisanya tidak dapat diekspor. */
function validRows(rows: readonly StagingRow[]): QcsnRow[] {
  const probe = parseQcsn(
    JSON.stringify({
      format: QCSN_FORMAT,
      version: QCSN_VERSION,
      rows: rows.map(toQcsnRow),
      checksum: '',
    }),
  );
  return probe.ok ? probe.rows : [];
}

/** Baris tabel yang dapat diekspor ke `.qcsn` (yang belum lengkap, mis. tanpa item atau lokasi, tidak). */
export function exportableRows(rows: readonly StagingRow[]): StagingRow[] {
  const ok = new Set(validRows(rows).map((row) => row.clientId));
  return rows.filter((row) => ok.has(row.clientId));
}

/** Berkas `.qcsn` (JSON) dari baris yang dapat diekspor; checksum SHA-256 atas isi baris kanonis. */
export async function exportQcsn(
  rows: readonly StagingRow[],
  app: { name: string; version: string },
  now: Date,
): Promise<string> {
  const exported = validRows(rows);
  return JSON.stringify({
    format: QCSN_FORMAT,
    version: QCSN_VERSION,
    exportedAt: now.toISOString(),
    app: { name: app.name, version: app.version },
    rows: exported,
    checksum: await checksumOf(exported),
  });
}

export interface QcsnImport {
  rows: QcsnRow[];
  problems: QcsnProblem[];
  /** Berkas tak dapat dipakai sama sekali (alasan untuk pengguna); `null` bila sebagian atau seluruh baris terbaca. */
  fatal: string | null;
  /** Peringatan (bukan galat): checksum tidak cocok pada berkas yang sebagian barisnya bermasalah. */
  warning: string | null;
}

const CHECKSUM_WARNING = 'Checksum berkas tidak cocok; isi berkas mungkin rusak atau diubah';

/** Checksum atas baris mentah berkas (termasuk yang bermasalah); `null` bila bentuknya tak dapat dihitung. */
async function rawChecksum(text: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(text);
    const rows = (parsed as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) return null;
    if (rows.some((row) => typeof row !== 'object' || row === null || Array.isArray(row)))
      return null;
    return await checksumOf(rows as QcsnRow[]);
  } catch {
    return null;
  }
}

/**
 * Membaca berkas `.qcsn`: struktur dan baris divalidasi `parseQcsn`. Checksum selalu diperiksa: atas baris sah bila
 * semuanya terbaca (tidak cocok = fatal), atau atas baris mentah bila ada yang bermasalah (tidak cocok = peringatan,
 * baris sah tetap diimpor).
 */
export async function importQcsn(text: string): Promise<QcsnImport> {
  const parsed = parseQcsn(text);
  if (!parsed.ok) return { rows: [], problems: [], fatal: parsed.message, warning: null };
  if (parsed.problems.length === 0) {
    const expected = await checksumOf(parsed.rows);
    if (expected !== parsed.file.checksum) {
      return {
        rows: [],
        problems: [],
        fatal: 'Berkas rusak atau terpotong (checksum tidak cocok)',
        warning: null,
      };
    }
    return { rows: parsed.rows, problems: [], fatal: null, warning: null };
  }
  const raw = await rawChecksum(text);
  return {
    rows: parsed.rows,
    problems: parsed.problems,
    fatal: null,
    // Checksum mentah yang tak dapat dihitung (mis. baris bukan objek) bukan bukti berkas rusak: cukup laporan per baris.
    warning: raw === null || raw === parsed.file.checksum ? null : CHECKSUM_WARNING,
  };
}
