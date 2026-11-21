import type { Env } from '@server/core/env';
import type { UserContext } from '@server/modules/access/context';
import type { SerialHistoryInput, SerialHistoryOutput } from '@shared/contract';
import { SERIAL_HISTORY_GROUPS, SERIAL_LIMITS } from '@shared/serials';
import { loadReadableSerialRow } from './readable';
import type { SerialEventRow } from './repo';
import { toEventsWithProofs } from './service';

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

interface CountRow {
  case_id: string;
  total: number | string;
  checks: number | string | null;
  changes: number | string | null;
}

/**
 * Riwayat per serial (tab linimasa): terbaru di atas (`seq` menurun), berkursor `seq` (kejadian dengan `seq` < kursor),
 * dapat disaring per kelompok jenis dan per kasus. `counts` dihitung dari SATU kueri agregat atas seluruh kejadian
 * serial (tidak terpengaruh filter) agar badge tab tetap utuh. Kasus milik serial lain = hasil kosong, bukan galat.
 */
export async function serialHistory(
  env: Env,
  user: UserContext,
  input: SerialHistoryInput,
): Promise<SerialHistoryOutput> {
  const row = await loadReadableSerialRow(env, user, input.id);
  const serialId = row.id.trim();
  const limit = input.limit ?? SERIAL_LIMITS.historyDefaultLimit;

  const where = ['serial_id = ?'];
  const binds: unknown[] = [serialId];
  if (input.group === 'checks' || input.group === 'changes') {
    const types = SERIAL_HISTORY_GROUPS[input.group];
    where.push(`type IN (${placeholders(types.length)})`);
    binds.push(...types);
  }
  if (input.caseId !== undefined) {
    where.push('case_id = ?');
    binds.push(input.caseId);
  }
  if (input.cursor !== undefined) {
    where.push('seq < ?');
    binds.push(Number(input.cursor));
  }
  const rows = await env.DB.prepare(
    `SELECT id, case_id, seq, type, occurred_on, created_at, actor_name, actor_team, message, changes_json, data_json FROM serial_events WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<SerialEventRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];

  const checks = SERIAL_HISTORY_GROUPS.checks;
  const changes = SERIAL_HISTORY_GROUPS.changes;
  const counted = await env.DB.prepare(
    `SELECT case_id, COUNT(*) AS total, SUM(type IN (${placeholders(checks.length)})) AS checks, SUM(type IN (${placeholders(changes.length)})) AS changes FROM serial_events WHERE serial_id = ? GROUP BY case_id`,
  )
    .bind(...checks, ...changes, serialId)
    .all<CountRow>();
  const counts: SerialHistoryOutput['counts'] = { all: 0, checks: 0, changes: 0, byCase: {} };
  for (const entry of counted.results) {
    const total = Number(entry.total);
    counts.all += total;
    counts.checks += Number(entry.checks ?? 0);
    counts.changes += Number(entry.changes ?? 0);
    const caseId = entry.case_id.trim();
    if (caseId !== '') counts.byCase[caseId] = total;
  }
  return {
    events: await toEventsWithProofs(env, page, { user, buId: row.bu_id.trim() }),
    nextCursor: rows.results.length > limit && last ? String(Number(last.seq)) : null,
    counts,
  };
}
