import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
import { planAttachFiles } from '@server/modules/files/service';
import type {
  SerialDto,
  SerialLookupInput,
  SerialLookupMatchDto,
  SerialLookupOutput,
  SerialReportNewInput,
} from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { wibDateIso } from '@shared/postel';
import { normalizeSerial, SERIAL_STATUS_LABELS, serialProblem } from '@shared/serials';
import { canWriteBu, writableBuIds } from './access';
import { insertCaseStmt, reserveCaseNumber, runWithCaseNumber } from './case-repo';
import {
  activeItemInBu,
  activeLocationName,
  insertEventStmt,
  insertSerialStmt,
  listSerialRows,
} from './repo';
import {
  ITEM_MESSAGE,
  LOCATION_MESSAGE,
  loadSerialDto,
  toSummary,
  validationError,
} from './service';

/**
 * Lapor Rusak (rancangan 2026-11-14 §4.3). `serials.lookup` mencocokkan Serial Number yang diketik/dipindai dengan serial
 * di BU yang dapat DITULIS pengguna (BU lain tak pernah muncul, jadi tak ada kebocoran keberadaan); `serials.reportNew`
 * membuat serial yang belum tercatat langsung berstatus Dilaporkan beserta laporannya, dalam satu transaksi.
 */
const DUPLICATE_MESSAGE = 'Serial Number sudah terdaftar, cari dulu lewat kolom Serial Number';
const LOOKUP_MAX = 50;

export async function lookupSerials(
  env: Env,
  user: UserContext,
  input: SerialLookupInput,
): Promise<SerialLookupOutput> {
  const buIds = writableBuIds(user);
  // Validator sudah menormalkan; dinormalkan lagi di sini agar pemanggil langsung (tes, layanan lain) tetap aman.
  const serial = normalizeSerial(input.serial);
  if (buIds.length === 0 || serialProblem(serial) !== null) return { matches: [] };
  const serials = [serial];
  const rows = await listSerialRows(env.DB, { buIds, serials, limit: LOOKUP_MAX });
  const matches = rows.slice(0, LOOKUP_MAX).map((row): SerialLookupMatchDto => {
    const summary = toSummary(row);
    return {
      id: summary.id,
      buId: summary.buId,
      buCode: summary.buCode,
      itemLabel: summary.itemLabel,
      serial: summary.serial,
      status: summary.status,
      custody: summary.custody,
      locationName: summary.locationName,
      openCaseId: row.open_case_id.trim() === '' ? null : row.open_case_id.trim(),
      openCaseNumber: summary.openCaseNumber,
      updatedAt: row.updated_at,
    };
  });
  matches.sort((a, b) => (a.buCode < b.buCode ? -1 : a.buCode > b.buCode ? 1 : 0));
  return { matches };
}

/**
 * Membuat serial baru berstatus Dilaporkan: kejadian `recorded` (seq 1) lalu `report_failure` (seq 2), tanggal uji =
 * `occurredOn`, tanpa stiker/stok. Urutan penolakan: tanggal masa depan, BU di luar hak tulis atau item/lokasi tak dikenal
 * (pesan generik tanpa menyebut BU/item lain), serial sudah ada di BU itu (`CONFLICT` generik). Nomor LP dipesan lewat
 * penghitung CAS dan seluruh pembuatan diulang bila penghitung diperebutkan (`runWithCaseNumber`).
 */
export async function reportNewSerial(
  env: Env,
  input: SerialReportNewInput,
  user: UserContext,
): Promise<SerialDto> {
  const today = wibDateIso(nowOf(env));
  if (input.occurredOn > today) {
    throw validationError('occurredOn', 'Tanggal tidak boleh di masa depan');
  }
  if (!canWriteBu(user, input.buId) || !(await activeItemInBu(env.DB, input.itemId, input.buId))) {
    throw validationError('itemId', ITEM_MESSAGE);
  }
  const locationName = await activeLocationName(env.DB, input.locationId);
  if (locationName === null) throw validationError('locationId', LOCATION_MESSAGE);

  const serialId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const recordedEventId = crypto.randomUUID();
  const reportEventId = crypto.randomUUID();
  const dateKey = today.replaceAll('-', '');

  const attempt = async (): Promise<void> => {
    const exists = await env.DB.prepare(
      'SELECT 1 AS present FROM serials WHERE bu_id = ? AND serial = ?',
    )
      .bind(input.buId, input.serial)
      .first<{ present: number }>();
    if (exists) throw appError('CONFLICT', DUPLICATE_MESSAGE, { serial: DUPLICATE_MESSAGE });
    const reservation = await reserveCaseNumber(env, dateKey);
    const now = nowIso(env);
    const actor = {
      actorId: user.userId ?? '',
      actorName: user.name,
      actorTeam: 'qc' as const,
    };
    const attach = await planAttachFiles(
      env,
      extractFileRefs(input.message),
      'serial',
      serialId,
      undefined,
      user.email,
    );
    const statements: DbStatement[] = [
      // Penghitung nomor LP paling depan: rebutan muncul sebagai kegagalan penjaganya dan diulang.
      ...reservation.statements,
      insertSerialStmt(env.DB, {
        id: serialId,
        clientId: `lapor-${serialId}`,
        buId: input.buId,
        serial: input.serial,
        itemId: input.itemId,
        testDate: input.occurredOn,
        sample: false,
        note: '',
        locationId: input.locationId,
        status: 'reported',
        openCaseId: caseId,
        now,
        actorEmail: user.email,
      }),
      insertCaseStmt(env.DB, {
        id: caseId,
        number: reservation.number,
        serialId,
        buId: input.buId,
        openedOn: input.occurredOn,
        originLocationId: input.locationId,
        now,
        actorEmail: user.email,
      }),
      insertEventStmt(env.DB, {
        id: recordedEventId,
        serialId,
        caseId: '',
        seq: 1,
        type: 'recorded',
        occurredOn: input.occurredOn,
        now,
        ...actor,
        message: '',
        changes: [],
        data: { stickers: [], locationId: input.locationId, locationName, source: 'report' },
      }),
      insertEventStmt(env.DB, {
        id: reportEventId,
        serialId,
        caseId,
        seq: 2,
        type: 'report_failure',
        occurredOn: input.occurredOn,
        now,
        ...actor,
        message: input.message,
        changes: [{ field: 'status', from: null, to: SERIAL_STATUS_LABELS.reported }],
        data: { caseNumber: reservation.number },
      }),
      ...attach,
    ];
    await env.DB.batch(statements);
  };

  try {
    await runWithCaseNumber(
      env,
      serialId,
      null,
      attempt,
      'Serial Number sedang diproses orang lain; coba lagi',
    );
  } catch (error) {
    if (error instanceof DbError && error.kind === 'duplicate') {
      // Serial yang sama dilaporkan serentak: pemenang sudah komit; yang kalah dijawab generik.
      throw mapDuplicateError(error, {
        serials_bu_serial: { message: DUPLICATE_MESSAGE, field: 'serial' },
        serials_client_id: { message: DUPLICATE_MESSAGE, field: 'serial' },
      });
    }
    throw error;
  }
  return loadSerialDto(env, user, serialId);
}
