import { isGuardFailure } from '@server/core/cas';
import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { isAppError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import type {
  SerialChangeDto,
  SerialExistingDto,
  SerialLookupManyInput,
  SerialLookupManyOutput,
  SerialRowInput,
  SerialRowResult,
} from '@shared/contract';
import {
  normalizeSerial,
  recheckBuCandidates,
  SERIAL_STATUSES,
  type SerialStatus,
  serialProblem,
} from '@shared/serials';
import { canWriteBu, writableBuIds } from './access';
import { stickerRaise } from './act';
import { involvedBuIds, moveBuStatements } from './bu-history';
import { loadStampItemInfo, planProofAttach } from './proof/attach';
import {
  insertNextEventStmt,
  itemLabelOf,
  loadSerialRowBySerial,
  type SerialColumn,
  type SerialRow,
  updateSerialStmt,
} from './repo';
import { LOCATION_MESSAGE, nextStamp, type SerialLookupMemo } from './service';

/**
 * Mencatat serial yang SUDAH ADA lewat Catat = cek ulang lolos pada catatan itu (keputusan pemilik 2026-11-18; spek serial
 * unik se-sistem §5.1). Pemakaian field baris: `testDate` hanya menjadi tanggal kejadian (tidak menimpa tanggal uji
 * pertama), `locationId` menjadi lokasi cek ulang DAN lokasi unit, `note` menjadi pesan kejadian, `sample` diabaikan;
 * stiker bawaan tidak ada yang tercentang (tak dikirim = tak ada). Syarat item aktif/terlihat TIDAK berlaku (item
 * catatan adalah acuan), tetapi item baris harus sama dengan item catatan.
 */

export const ACTIVE_CASE_MESSAGE =
  'Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya.';
export const BROKEN_MESSAGE = 'Unit ini sudah dinyatakan rusak.';
const BU_MESSAGE = 'BU ini tidak bisa dipilih untuk Serial Number yang sudah ada';
const GENERIC_ITEM_MESSAGE = 'Item tidak ditemukan atau tidak bisa dipakai';
const FAILED_MESSAGE = 'Serial Number gagal disimpan. Coba lagi';
/** Percobaan ulang bila batch dibatalkan penjaga (serial berubah di sela) atau BU target direbut penulis lain. */
const MAX_ATTEMPTS = 6;

export type RecheckPlan =
  | { ok: true; statements: DbStatement[]; serialId: string }
  | { ok: false; message: string };

const SERIAL_STATUS_SET: readonly string[] = SERIAL_STATUSES;

/**
 * Menyusun batch cek ulang untuk satu baris Catat terhadap catatan `existing`. Hak tulis BU target diperiksa pemanggil
 * lebih dulu, tetapi diperiksa ulang di sini. Penolakan = `{ ok: false, message }` tanpa efek; galat tak terduga
 * dilempar.
 */
export async function planRecheckFromRow(
  env: Env,
  user: UserContext,
  existing: SerialRow,
  row: SerialRowInput,
  memo: SerialLookupMemo,
): Promise<RecheckPlan> {
  const fail = (message: string): RecheckPlan => ({ ok: false, message });
  const serialId = existing.id.trim();
  const currentBuId = existing.bu_id.trim();
  if (!canWriteBu(user, row.buId)) return fail(GENERIC_ITEM_MESSAGE);

  const status = existing.status.trim();
  if (status === 'broken') return fail(BROKEN_MESSAGE);
  if (existing.open_case_id.trim() !== '' || status !== 'good') return fail(ACTIVE_CASE_MESSAGE);

  const existingItemId = existing.item_id.trim();
  if (row.itemId !== existingItemId) {
    const label = (await itemLabelOf(env.DB, existingItemId)) ?? '';
    return fail(
      `Serial ini sudah tercatat dengan item ${label}. Ubah itemnya lewat detail Serial Number bila memang salah.`,
    );
  }

  // BU target: BU saat ini atau BU yang belum pernah terlibat (BU yang pernah ditinggalkan tidak boleh kembali).
  const involved = await involvedBuIds(env.DB, serialId);
  const allowed = recheckBuCandidates({
    currentBuId,
    involvedBuIds: involved,
    writableBuIds: [row.buId],
  });
  if (allowed.length === 0) return fail(BU_MESSAGE);
  const moves = row.buId !== currentBuId;
  if (moves) {
    const target = await env.DB.prepare(
      "SELECT code FROM business_units WHERE id = ? AND status = 'active'",
    )
      .bind(row.buId)
      .first<{ code: string }>();
    if (!target) return fail(GENERIC_ITEM_MESSAGE);
  }

  const proofMin = await memo.proofMinOf(existingItemId);
  if (proofMin > (row.proofPhotoIds?.length ?? 0)) {
    return fail(`Item ini wajib foto bukti minimal ${proofMin}`);
  }
  const locationName = await memo.activeLocationName(row.locationId);
  if (locationName === null) return fail(LOCATION_MESSAGE);

  const now = nextStamp(nowIso(env), existing.updated_at);
  const eventId = crypto.randomUUID();
  const stickerIds = (row.stickers ?? []).map((pick) => pick.stickerId);
  try {
    // Stiker yang berlaku mengikuti BU target; tiap stiker tercentang +1 dan memotong stok 1 di lokasi cek ulang.
    const raise = await stickerRaise(
      env,
      existing,
      eventId,
      row.locationId,
      stickerIds,
      user,
      now,
      false,
      row.buId,
    );
    const proofStatements = await planProofAttach(env, row.proofPhotoIds, {
      user,
      serialId,
      eventId,
      snapshot: {
        serial: existing.serial,
        ...(await loadStampItemInfo(env.DB, existingItemId, row.buId)),
        locationName,
        actorName: user.name,
        actorTeam: 'qc',
      },
      now,
    });

    const set: Partial<Record<SerialColumn, string | number>> = {};
    const changes: SerialChangeDto[] = [];
    if (row.locationId !== existing.location_id.trim()) {
      set.location_id = row.locationId;
      changes.push({ field: 'location', from: existing.location_name ?? '', to: locationName });
    }
    changes.push(...raise.changes);
    const data: Record<string, unknown> = {
      result: 'pass',
      locationId: row.locationId,
      locationName,
    };
    if (raise.raised.length > 0) data.stickers = raise.raised;
    if (moves) {
      const codeOf = async (buId: string): Promise<string> =>
        (
          await env.DB.prepare('SELECT code FROM business_units WHERE id = ?')
            .bind(buId)
            .first<{ code: string }>()
        )?.code ?? '';
      data.bu = {
        fromId: currentBuId,
        fromCode: existing.bu_code.trim(),
        toId: row.buId,
        toCode: await codeOf(row.buId),
      };
    }
    if (row.source !== undefined) data.source = row.source;

    const statements: DbStatement[] = [
      updateSerialStmt(env.DB, {
        id: serialId,
        expectedUpdatedAt: existing.updated_at,
        now,
        actorEmail: user.email,
        set,
      }),
      ...(moves
        ? moveBuStatements(env, { serialId, fromBuId: currentBuId, toBuId: row.buId, now })
        : []),
      insertNextEventStmt(env.DB, {
        id: eventId,
        serialId,
        caseId: '',
        type: 'recheck',
        occurredOn: row.testDate,
        now,
        actorId: user.userId ?? '',
        actorName: user.name,
        actorTeam: 'qc',
        message: row.note,
        changes,
        data,
        clientId: row.clientId,
      }),
      ...raise.statements,
      ...proofStatements,
    ];
    return { ok: true, statements, serialId };
  } catch (error) {
    if (isAppError(error) && error.code === 'VALIDATION') return fail(error.message);
    throw error;
  }
}

const rechecked = (row: SerialRowInput, id: string): SerialRowResult => ({
  clientId: row.clientId,
  result: 'rechecked',
  message: '',
  id,
  serial: row.serial,
});

/**
 * Cek ulang untuk baris Catat bila serialnya sudah ada (global); `null` bila belum ada (pemanggil membuat serial baru).
 * Dinilai ulang dari awal bila batch dibatalkan penjaga CAS (serial berubah di sela) atau BU target direbut penulis lain;
 * kirim ulang baris yang sama dikenali dari `client_id` kejadian (tanpa kejadian dan potongan stok ganda).
 */
export async function recheckExistingSerial(
  env: Env,
  user: UserContext,
  row: SerialRowInput,
  memo: SerialLookupMemo,
): Promise<SerialRowResult | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await loadSerialRowBySerial(env.DB, row.serial);
    if (!existing) return null;
    // Kirim ulang baris yang sama: kejadian dengan pengenal ini sudah ada (tanpa efek baru); pengenal milik serial lain =
    // baris tidak valid (bukan idempoten).
    const done = await env.DB.prepare('SELECT serial_id FROM serial_events WHERE client_id = ?')
      .bind(row.clientId)
      .first<{ serial_id: string }>();
    if (done) {
      return done.serial_id.trim() === existing.id.trim()
        ? rechecked(row, existing.id.trim())
        : {
            clientId: row.clientId,
            result: 'invalid',
            message: 'Baris tidak valid',
            serial: row.serial,
          };
    }
    // Hak tulis BU target lebih dulu: di luar hak = generik, tanpa membaca apa pun tentang catatan itu.
    if (!canWriteBu(user, row.buId)) {
      return {
        clientId: row.clientId,
        result: 'invalid',
        message: GENERIC_ITEM_MESSAGE,
        serial: row.serial,
      };
    }
    const plan = await planRecheckFromRow(env, user, existing, row, memo);
    if (!plan.ok) {
      return {
        clientId: row.clientId,
        result: 'invalid',
        message: plan.message,
        serial: row.serial,
      };
    }
    try {
      await env.DB.batch(plan.statements);
      return rechecked(row, plan.serialId);
    } catch (error) {
      // Penjaga CAS gagal (serial atau klaim foto berubah), BU target direbut (PRIMARY), kejadian dengan pengenal ini
      // sudah ada (balapan kirim ulang), atau deadlock: nilai ulang dari awal.
      const retry =
        isGuardFailure(error) ||
        (error instanceof DbError &&
          (error.kind === 'deadlock' ||
            (error.kind === 'duplicate' &&
              (error.key === 'PRIMARY' || error.key === 'serial_events_client_id'))));
      if (retry) continue;
      console.error(
        'serials.saveBatch: cek ulang gagal disimpan',
        error instanceof Error ? error.name : '',
      );
      return {
        clientId: row.clientId,
        result: 'error',
        message: FAILED_MESSAGE,
        serial: row.serial,
      };
    }
  }
  return { clientId: row.clientId, result: 'error', message: FAILED_MESSAGE, serial: row.serial };
}

interface ExistingRow {
  id: string;
  serial: string;
  item_id: string;
  bu_id: string;
  bu_code: string;
  status: string;
  open_case_id: string;
  brand_name: string | null;
  model: string | null;
  proof_required: number | string | null;
  proof_min: number | string | null;
}

/**
 * Draft Catat: serial yang sudah ada, dengan pengungkapan MINIMAL lintas BU (spek §5.4, §7): item, BU saat ini, status,
 * laporan aktif, aturan foto, dan BU yang boleh dipilih pengguna ini. Tanpa catatan, riwayat, lokasi, atau pelaku.
 */
export async function lookupSerialsMany(
  env: Env,
  user: UserContext,
  input: SerialLookupManyInput,
): Promise<SerialLookupManyOutput> {
  const serials = [
    ...new Set(
      input.serials.map(normalizeSerial).filter((serial) => serialProblem(serial) === null),
    ),
  ];
  if (serials.length === 0) return { found: [] };
  const marks = serials.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT s.id, s.serial, s.item_id, s.bu_id, bu.code AS bu_code, s.status, s.open_case_id, b.name AS brand_name, i.model, i.proof_required, i.proof_min FROM serials s JOIN business_units bu ON bu.id = s.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE s.serial IN (${marks})`,
  )
    .bind(...serials)
    .all<ExistingRow>();
  if (rows.results.length === 0) return { found: [] };
  const ids = rows.results.map((entry) => entry.id.trim());
  const history = await env.DB.prepare(
    `SELECT serial_id, bu_id FROM serial_business_units WHERE serial_id IN (${ids.map(() => '?').join(', ')})`,
  )
    .bind(...ids)
    .all<{ serial_id: string; bu_id: string }>();
  const involved = new Map<string, string[]>();
  for (const entry of history.results) {
    const list = involved.get(entry.serial_id.trim()) ?? [];
    list.push(entry.bu_id.trim());
    involved.set(entry.serial_id.trim(), list);
  }
  const writable = writableBuIds(user);
  const found = rows.results.map((entry): SerialExistingDto => {
    const id = entry.id.trim();
    const buId = entry.bu_id.trim();
    const status = entry.status.trim();
    const required = Number(entry.proof_required ?? 0) === 1;
    return {
      serial: entry.serial,
      id,
      itemId: entry.item_id.trim(),
      itemLabel: `${entry.brand_name ?? ''} ${(entry.model ?? '').trim()}`.trim(),
      buId,
      buCode: entry.bu_code.trim(),
      status: (SERIAL_STATUS_SET.includes(status) ? status : 'good') as SerialStatus,
      hasOpenCase: entry.open_case_id.trim() !== '',
      proofRequired: required,
      proofMin: Number(entry.proof_min ?? 1),
      recheckBuIds: recheckBuCandidates({
        currentBuId: buId,
        involvedBuIds: [...(involved.get(id) ?? []), buId],
        writableBuIds: writable,
      }),
    };
  });
  found.sort((a, b) => (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0));
  return { found };
}
