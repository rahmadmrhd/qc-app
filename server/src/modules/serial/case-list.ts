import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type { SerialCaseListInput, SerialCaseListOutput, SerialCaseRowDto } from '@shared/contract';
import { markdownToPlain } from '@shared/markdown-plain';
import { wibDateIso } from '@shared/postel';
import {
  normalizeSerial,
  SERIAL_CUSTODIES,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialStatus,
} from '@shared/serials';
import { readableBuIds } from './access';
import { daysBetween } from './dates';
import { escapeLike } from './repo';
import { SERIAL_LIST_DEFAULT_LIMIT } from './validate';

/**
 * Daftar Laporan (rancangan 2026-11-14 §4.5): satu baris per laporan (`serial_cases`) pada BU yang boleh dibaca. Pembacaan
 * TIDAK dibatasi status serial (tim servis murni melihat semua laporan di BU-nya). Urut terbaru dulu
 * (`created_at DESC, number DESC`); kursor = `created_at|number`.
 */
interface CaseListRow {
  id: string;
  number: string;
  serial_id: string;
  bu_id: string;
  opened_on: string;
  closed_on: string;
  outcome: string;
  created_at: string;
  created_by: string;
  serial: string;
  status: string;
  custody: string;
  bu_code: string;
  brand_name: string | null;
  model: string | null;
  status_changed_on: string | null;
  report_message: string | null;
  location_name: string | null;
}

const STATUS_SET: readonly string[] = SERIAL_STATUSES;
const CUSTODY_SET: readonly string[] = SERIAL_CUSTODIES;

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/** Baris pertama yang berisi dari catatan laporan (Markdown dibersihkan), dipotong ke `reportSummaryMax` karakter. */
export function caseSummary(message: string): string {
  const { text } = markdownToPlain(message);
  const first = text.split('\n').find((line) => line.trim() !== '') ?? '';
  const chars = [...first.trim()];
  if (chars.length <= SERIAL_LIMITS.reportSummaryMax) return chars.join('');
  return `${chars.slice(0, SERIAL_LIMITS.reportSummaryMax - 1).join('')}…`;
}

export async function listSerialCases(
  env: Env,
  user: UserContext,
  input: SerialCaseListInput,
): Promise<SerialCaseListOutput> {
  const buIds = readableBuIds(user);
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? SERIAL_LIST_DEFAULT_LIMIT;
  const where = [`c.bu_id IN (${placeholders(buIds.length)})`];
  const binds: unknown[] = [...buIds];
  if (input.status === 'active') where.push("c.closed_on = ''");
  if (input.status === 'closed') where.push("c.closed_on <> ''");
  if (input.buId !== undefined) {
    where.push('c.bu_id = ?');
    binds.push(input.buId);
  }
  const query = normalizeSerial(input.query ?? '');
  if (query !== '') {
    where.push("(c.number LIKE ? ESCAPE '!' OR s.serial LIKE ? ESCAPE '!')");
    binds.push(`${escapeLike(query)}%`, `${escapeLike(query)}%`);
  }
  if (input.cursor !== undefined) {
    const match = /^([^|]+)\|([^|]+)$/.exec(input.cursor);
    if (match?.[1] && match[2]) {
      where.push('(c.created_at < ? OR (c.created_at = ? AND c.number < ?))');
      binds.push(match[1], match[1], match[2]);
    }
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.number, c.serial_id, c.bu_id, c.opened_on, c.closed_on, c.outcome, c.created_at, c.created_by, s.serial, s.status, s.custody, bu.code AS bu_code, b.name AS brand_name, i.model, (SELECT e.occurred_on FROM serial_events e WHERE e.serial_id = c.serial_id AND e.changes_json LIKE '%"field":"status"%' ORDER BY e.seq DESC LIMIT 1) AS status_changed_on, (SELECT e.message FROM serial_events e WHERE e.serial_id = c.serial_id AND e.case_id = c.id AND e.type = 'report_failure' ORDER BY e.seq LIMIT 1) AS report_message, l.name AS location_name FROM serial_cases c JOIN serials s ON s.id = c.serial_id LEFT JOIN locations l ON l.id = s.location_id JOIN business_units bu ON bu.id = c.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('s')} AND ${where.join(' AND ')} ORDER BY c.created_at DESC, c.number DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<CaseListRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const today = wibDateIso(nowOf(env));
  const items = page.map((row): SerialCaseRowDto => {
    const status = row.status.trim();
    const custody = row.custody.trim();
    const outcome = row.outcome.trim();
    const since =
      row.status_changed_on && row.status_changed_on !== '' ? row.status_changed_on : row.opened_on;
    return {
      id: row.id.trim(),
      number: row.number,
      serialId: row.serial_id.trim(),
      serial: row.serial,
      buId: row.bu_id.trim(),
      buCode: row.bu_code.trim(),
      itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
      status: (STATUS_SET.includes(status) ? status : 'good') as SerialStatus,
      custody: (CUSTODY_SET.includes(custody) ? custody : 'qc') as SerialCustody,
      openedOn: row.opened_on,
      closedOn: row.closed_on.trim() === '' ? null : row.closed_on,
      outcome: outcome === 'good' || outcome === 'broken' ? outcome : null,
      daysInStatus: daysBetween(since, today) ?? 0,
      locationName: row.location_name ?? '',
      durationDays:
        daysBetween(row.opened_on, row.closed_on.trim() === '' ? today : row.closed_on) ?? 0,
      reporter: row.created_by,
      summary: caseSummary(row.report_message ?? ''),
    };
  });
  return {
    items,
    nextCursor: rows.results.length > limit && last ? `${last.created_at}|${last.number}` : null,
  };
}
