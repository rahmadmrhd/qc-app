import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
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
import {
  caseNumberPeriod,
  normalizeSerial,
  SERIAL_STATUS_LABELS,
  serialProblem,
} from '@shared/serials';
import { writableBuIds } from './access';
import { insertCaseStmt, reserveCaseNumber, runWithCaseNumber } from './case-repo';
import {
  activeItemWritableForBu,
  activeLocationName,
  insertEventStmt,
  insertSerialStmt,
  loadSerialRowBySerial,
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
 * yang BU SAAT INI-nya dapat DITULIS pengguna (Serial Number unik se-sistem); serial di BU lain hanya mengungkap kode BU
 * saat ini (`elsewhere`), tanpa data lain. `serials.reportNew`
 * membuat serial yang belum tercatat langsung berstatus Dilaporkan beserta laporannya, dalam satu transaksi.
 */
const DUPLICATE_MESSAGE = 'Serial Number sudah terdaftar, cari dulu lewat kolom Serial Number';

export async function lookupSerials(
  env: Env,
  user: UserContext,
  input: SerialLookupInput,
): Promise<SerialLookupOutput> {
  const buIds = writableBuIds(user);
  // Validator sudah menormalkan; dinormalkan lagi di sini agar pemanggil langsung (tes, layanan lain) tetap aman.
  const serial = normalizeSerial(input.serial);
  if (buIds.length === 0 || serialProblem(serial) !== null) return { matches: [], elsewhere: null };
  // Serial Number unik se-sistem: cari global lalu nilai hak tulis pada BU SAAT INI. Di luar hak tulis, hanya kode BU
  // saat ini yang terungkap (`elsewhere`), tanpa data lain.
  const found = await loadSerialRowBySerial(env.DB, serial);
  if (!found) return { matches: [], elsewhere: null };
  if (!buIds.includes(found.bu_id.trim())) {
    return { matches: [], elsewhere: { buCode: found.bu_code.trim() } };
  }
  const rows = [found];
  const matches = rows.map((row): SerialLookupMatchDto => {
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
  return { matches, elsewhere: null };
}

/**
 * Membuat serial baru berstatus Dilaporkan: kejadian `recorded` (seq 1) lalu `report_failure` (seq 2), tanggal uji =
 * `occurredOn`, tanpa stiker/stok. Urutan penolakan: tanggal masa depan, BU di luar hak tulis atau item/lokasi tak dikenal
 * (pesan generik tanpa menyebut BU/item lain), serial sudah ada di BU mana pun (unik se-sistem; `CONFLICT` generik). Nomor LP (LP/<BU>/YYMM-iiii) dipesan lewat
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
  if (!(await activeItemWritableForBu(env.DB, input.itemId, input.buId, user))) {
    throw validationError('itemId', ITEM_MESSAGE);
  }
  const locationName = await activeLocationName(env.DB, input.locationId);
  if (locationName === null) throw validationError('locationId', LOCATION_MESSAGE);

  const serialId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const recordedEventId = crypto.randomUUID();
  const reportEventId = crypto.randomUUID();
  // Kode BU target (BU sudah tervalidasi lewat activeItemWritableForBu) dan periode WIB untuk nomor LP/<BU>/YYMM-iiii.
  const buRow = await env.DB.prepare('SELECT code FROM business_units WHERE id = ?')
    .bind(input.buId)
    .first<{ code: string }>();
  if (!buRow) throw validationError('itemId', ITEM_MESSAGE);
  const buCode = buRow.code.trim();
  const period = caseNumberPeriod(today);

  const attempt = async (): Promise<void> => {
    const exists = await env.DB.prepare(
      `SELECT 1 AS present FROM serials WHERE ${liveWhere()} AND serial = ?`,
    )
      .bind(input.serial)
      .first<{ present: number }>();
    if (exists) throw appError('CONFLICT', DUPLICATE_MESSAGE, { serial: DUPLICATE_MESSAGE });
    const reservation = await reserveCaseNumber(env, buCode, period);
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
        serials_serial: { message: DUPLICATE_MESSAGE, field: 'serial' },
        serials_client_id: { message: DUPLICATE_MESSAGE, field: 'serial' },
      });
    }
    throw error;
  }
  return loadSerialDto(env, user, serialId);
}
