import { batchGuarded } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { statementsFor } from '@server/core/events';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
import { planAttachFiles } from '@server/modules/files/service';
import type { SerialActInput, SerialChangeDto, SerialDto } from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { wibDateIso } from '@shared/postel';
import { type FlowRow, resolveAction } from '@shared/serial-flow';
import {
  SERIAL_CUSTODIES,
  SERIAL_CUSTODY_LABELS,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialEventType,
  type SerialStatus,
} from '@shared/serials';
import { assertSerialVisible, modulesOn } from './access';
import { applicableStickersOf } from './applicable';
import {
  closeCaseStmt,
  insertCaseStmt,
  loadCase,
  reserveCaseNumber,
  runWithCaseNumber,
  updateCaseDamageStmt,
} from './case-repo';
import {
  activeLocationName,
  insertNextEventStmt,
  loadSerialRow,
  loadSerialStickers,
  type SerialColumn,
  type SerialRow,
  updateSerialStmt,
  upsertSerialStickerStmt,
} from './repo';
import {
  LOCATION_MESSAGE,
  loadSerialDto,
  nextStamp,
  SERIAL_CONFLICTS,
  STALE_MESSAGE,
  toStickerStatus,
  validationError,
} from './service';

const stickerChip = (name: string, qty: number | null): string | null =>
  qty === null ? null : `${name} ×${qty}`;

const STATUS_SET: readonly string[] = SERIAL_STATUSES;
const CUSTODY_SET: readonly string[] = SERIAL_CUSTODIES;

const asStatus = (value: string): SerialStatus =>
  (STATUS_SET.includes(value.trim()) ? value.trim() : 'good') as SerialStatus;
const asCustody = (value: string): SerialCustody =>
  (CUSTODY_SET.includes(value.trim()) ? value.trim() : 'qc') as SerialCustody;

/** Satu kejadian yang akan ditulis; `id` dibuat di awal karena stok dan job surel merujuknya. */
interface EventDraft {
  id: string;
  caseId: string;
  type: SerialEventType;
  message: string;
  changes: SerialChangeDto[];
  data: Record<string, unknown>;
}

/** Selisih hari kalender `from` -> `to` (`YYYY-MM-DD`), tak pernah negatif; `null` bila `from` tak berbentuk tanggal. */
function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const damageChip = (from: string | null, to: string): SerialChangeDto => ({
  field: 'damage',
  from: from === null || from === '' ? null : from,
  to,
});

interface StickerRaise {
  /** `serial_stickers` upsert dan pendengar stok (`serial.stickers_added`), dipasang ke batch aksi. */
  statements: DbStatement[];
  changes: SerialChangeDto[];
  raised: { stickerId: string; name: string; qtyFrom: number; qtyTo: number }[];
}

/**
 * Kenaikan jumlah stiker pada cek ulang (baris 10-13, spek §5.2): jumlah tidak boleh turun, stiker `inactive` tak boleh
 * naik, stiker baru harus berlaku bagi item pada BU serial; selisih positif memotong stok di `locationId` lewat pendengar
 * `serial.stickers_added` dalam batch yang sama.
 */
async function stickerRaise(
  env: Env,
  row: SerialRow,
  eventId: string,
  locationId: string,
  requested: readonly { stickerId: string; qty: number }[],
  user: UserContext,
  now: string,
): Promise<StickerRaise> {
  const serialId = row.id.trim();
  const current = new Map(
    (await loadSerialStickers(env.DB, serialId)).map((sticker) => [
      sticker.sticker_id.trim(),
      {
        qty: Number(sticker.qty),
        name: sticker.name ?? '',
        status: toStickerStatus(sticker.status),
      },
    ]),
  );
  const unknown = requested.filter((pick) => !current.has(pick.stickerId));
  const applicable =
    unknown.length > 0
      ? new Map(
          (await applicableStickersOf(env, row.item_id.trim(), row.bu_id.trim())).map((sticker) => [
            sticker.id,
            sticker,
          ]),
        )
      : new Map();
  const statements: DbStatement[] = [];
  const changes: SerialChangeDto[] = [];
  const picks: { stickerId: string; qty: number }[] = [];
  const raised: StickerRaise['raised'] = [];
  for (const pick of requested) {
    const existing = current.get(pick.stickerId);
    if (existing && pick.qty < existing.qty) {
      throw validationError('stickers', 'Jumlah stiker tidak boleh diturunkan');
    }
    if (existing && pick.qty > existing.qty && existing.status === 'inactive') {
      throw validationError('stickers', 'Stiker nonaktif tidak dapat ditambah jumlahnya');
    }
    if (!existing && !applicable.has(pick.stickerId)) {
      throw validationError('stickers', 'Stiker tidak berlaku bagi item ini');
    }
    const from = existing?.qty ?? 0;
    if (pick.qty === from) continue;
    const name = existing?.name ?? applicable.get(pick.stickerId)?.name ?? '';
    picks.push({ stickerId: pick.stickerId, qty: pick.qty - from });
    raised.push({ stickerId: pick.stickerId, name, qtyFrom: from, qtyTo: pick.qty });
    changes.push({
      field: 'stickers',
      from: stickerChip(name, existing ? from : null),
      to: stickerChip(name, pick.qty),
    });
    statements.push(upsertSerialStickerStmt(env.DB, serialId, pick.stickerId, pick.qty));
  }
  if (raised.length > 0) {
    statements.push(
      ...(await statementsFor(env, 'serial.stickers_added', {
        serialId,
        eventId,
        locationId,
        picks,
        actor: user.email,
        now,
      })),
    );
  }
  return { statements, changes, raised };
}

/** Aksi yang membuka kasus baru (membutuhkan nomor LP dari penghitung CAS). */
function opensCase(input: SerialActInput): boolean {
  return (
    input.action === 'report_failure' || (input.action === 'recheck' && input.result === 'fail')
  );
}

/**
 * `serials.act` (spek §5.3, tabel di `shared/serial-flow.ts`). Urutan galat: (1) bentuk, termasuk tanggal masa depan;
 * (2) serial tak ada atau BU di luar hak baca = `NOT_FOUND`; (3) `updated_at` usang = stale; (4) aksi tak ada untuk
 * keadaan serial = `CONFLICT`; (5) ada tetapi modul pelaku tak cukup = `FORBIDDEN`; (6) rujukan tak sah = `VALIDATION`.
 * Semua efek (serial, kasus, kejadian, stok, klaim berkas, job surel) ditulis dalam SATU `batch()`. Seluruh muat
 * keadaan -> susun -> tulis diulang bila penghitung nomor LP diperebutkan (`runWithCaseNumber`), jadi semua kondisi
 * dihitung ulang pada tiap percobaan.
 */
export async function actOnSerial(
  env: Env,
  input: SerialActInput,
  user: UserContext,
): Promise<SerialDto> {
  const today = wibDateIso(nowOf(env));
  if (input.occurredOn > today) {
    throw validationError('occurredOn', 'Tanggal tidak boleh di masa depan');
  }
  const withCase = opensCase(input);
  const attempt = () => applyAct(env, input, user, today, withCase);
  try {
    if (withCase) {
      await runWithCaseNumber(env, input.id, input.expectedUpdatedAt, attempt, STALE_MESSAGE);
    } else {
      await attempt();
    }
  } catch (error) {
    throw mapDuplicateError(error, SERIAL_CONFLICTS);
  }
  return loadSerialDto(env, user, input.id);
}

async function applyAct(
  env: Env,
  input: SerialActInput,
  user: UserContext,
  today: string,
  withCase: boolean,
): Promise<void> {
  const row = await loadSerialRow(env.DB, input.id);
  if (!row) throw appError('NOT_FOUND', 'Serial Number tidak ditemukan');
  const buId = row.bu_id.trim();
  assertSerialVisible(user, buId);
  if (row.updated_at !== input.expectedUpdatedAt) throw staleError(STALE_MESSAGE);

  const serialId = row.id.trim();
  const status = asStatus(row.status);
  const custody = asCustody(row.custody);
  const resolved = resolveAction(
    input.action,
    { status, custody },
    modulesOn(user, buId),
    input.action === 'recheck' ? (input.result ?? 'pass') : undefined,
  );
  if ('error' in resolved) {
    throw resolved.error === 'state'
      ? appError('CONFLICT', 'Aksi ini tidak bisa dilakukan pada keadaan Serial Number sekarang')
      : appError('FORBIDDEN', 'Aksi ini bukan bagian tim kamu');
  }
  const flow: FlowRow = resolved.row;

  const now = nextStamp(nowIso(env), row.updated_at);
  const set: Partial<Record<SerialColumn, string | number>> = {};
  const counterStatements: DbStatement[] = [];
  const caseStatements: DbStatement[] = [];
  const tail: DbStatement[] = [];
  const extraEvents: EventDraft[] = [];

  const openCaseId = row.open_case_id.trim();
  const currentLocationId = row.location_id.trim();
  const currentLocationName = row.location_name ?? '';
  const eventId = crypto.randomUUID();
  const newCaseId = crypto.randomUUID();

  const loadOpenCase = async () => {
    const found = openCaseId === '' ? null : await loadCase(env.DB, openCaseId);
    if (!found) throw appError('CONFLICT', 'Kasus untuk Serial Number ini tidak ditemukan');
    return found;
  };
  /** Membuka kasus baru: nomor LP dipesan dan penjaganya ikut batch (selalu paling depan). */
  const openNewCase = async (damageText: string): Promise<string> => {
    const reservation = await reserveCaseNumber(env, today.replaceAll('-', ''));
    counterStatements.push(...reservation.statements);
    caseStatements.push(
      insertCaseStmt(env.DB, {
        id: newCaseId,
        number: reservation.number,
        serialId,
        buId,
        openedOn: input.occurredOn,
        damage: damageText,
        now,
        actorEmail: user.email,
      }),
    );
    set.open_case_id = newCaseId;
    return reservation.number;
  };

  // Perubahan status/posisi, dipasang pada kejadian utama aksi.
  const stateChanges: SerialChangeDto[] = [];
  const newStatus = flow.toStatus === 'same' ? status : flow.toStatus;
  const newCustody = flow.toCustody === 'same' ? custody : flow.toCustody;
  if (newStatus !== status) {
    set.status = newStatus;
    stateChanges.push({
      field: 'status',
      from: SERIAL_STATUS_LABELS[status],
      to: SERIAL_STATUS_LABELS[newStatus],
    });
  }
  if (newCustody !== custody) {
    set.custody = newCustody;
    stateChanges.push({
      field: 'custody',
      from: SERIAL_CUSTODY_LABELS[custody],
      to: SERIAL_CUSTODY_LABELS[newCustody],
    });
  }

  const main: EventDraft = {
    id: eventId,
    caseId: openCaseId,
    type: input.action as SerialEventType,
    message: input.message,
    changes: [...stateChanges],
    data: {},
  };
  const damage = 'damage' in input && typeof input.damage === 'string' ? input.damage : undefined;

  switch (input.action) {
    case 'report_failure': {
      const number = await openNewCase(input.damage);
      main.caseId = newCaseId;
      main.changes.push(damageChip(null, input.damage));
      main.data = { caseNumber: number, damage: input.damage };
      break;
    }
    case 'identify_damage':
    case 'service_diagnosis': {
      const found = await loadOpenCase();
      caseStatements.push(updateCaseDamageStmt(env.DB, found.id.trim(), input.damage, now));
      main.changes.push(damageChip(found.damage, input.damage));
      main.data = { caseNumber: found.number, damage: input.damage };
      break;
    }
    case 'declare_broken': {
      const found = await loadOpenCase();
      caseStatements.push(closeCaseStmt(env.DB, found.id.trim(), 'broken', input.occurredOn, now));
      set.open_case_id = '';
      main.data = { caseNumber: found.number, damage: found.damage, outcome: 'broken' };
      break;
    }
    case 'send': {
      if (input.toLocationId === currentLocationId) {
        throw validationError('toLocationId', 'Lokasi tujuan harus beda dengan lokasi sekarang');
      }
      const toName = await activeLocationName(env.DB, input.toLocationId);
      if (toName === null) throw validationError('toLocationId', LOCATION_MESSAGE);
      set.transit_from_location_id = currentLocationId;
      set.transit_to_location_id = input.toLocationId;
      set.transit_on = input.occurredOn;
      main.data = {
        leg: flow.leg,
        fromLocationId: currentLocationId,
        fromLocationName: currentLocationName,
        toLocationId: input.toLocationId,
        toLocationName: toName,
        shipmentNote: input.shipmentNote,
      };
      break;
    }
    case 'receive': {
      const targetId = row.transit_to_location_id.trim();
      const targetName = row.transit_to_name ?? currentLocationName;
      if (targetId !== '' && targetId !== currentLocationId) {
        set.location_id = targetId;
        main.changes.push({ field: 'location', from: currentLocationName, to: targetName });
      }
      set.transit_from_location_id = '';
      set.transit_to_location_id = '';
      set.transit_on = '';
      main.data = {
        leg: flow.leg,
        fromLocationName: row.transit_from_name ?? '',
        toLocationName: targetName,
        daysInTransit: daysBetween(row.transit_on, input.occurredOn),
      };
      break;
    }
    case 'recheck':
    case 'recheck_pass':
    case 'recheck_fail': {
      const locationId = input.locationId ?? currentLocationId;
      const locationChanges: SerialChangeDto[] = [];
      let locationName = currentLocationName;
      if (locationId !== currentLocationId) {
        const name = await activeLocationName(env.DB, locationId);
        if (name === null) throw validationError('locationId', LOCATION_MESSAGE);
        set.location_id = locationId;
        locationChanges.push({ field: 'location', from: currentLocationName, to: name });
        locationName = name;
      }
      // Lokasi yang tidak diganti boleh sudah nonaktif: hanya lokasi BARU yang wajib aktif (diperiksa di atas).
      const raise = await stickerRaise(
        env,
        row,
        eventId,
        locationId,
        input.stickers ?? [],
        user,
        now,
      );
      tail.push(...raise.statements);
      const checkData: Record<string, unknown> = { locationId, locationName };
      if (raise.raised.length > 0) checkData.stickers = raise.raised;

      if (input.action === 'recheck') {
        const result = input.result ?? 'pass';
        checkData.result = result;
        if (result === 'pass') {
          main.changes.push(...locationChanges, ...raise.changes);
        } else {
          // Baris 13: kejadian `recheck` (hasil tidak lolos) lalu `report_failure` yang membawa kasus baru.
          const failDamage = damage ?? '';
          const number = await openNewCase(failDamage);
          main.caseId = '';
          main.changes = [...locationChanges, ...raise.changes];
          extraEvents.push({
            id: crypto.randomUUID(),
            caseId: newCaseId,
            type: 'report_failure',
            message: '',
            changes: [...stateChanges, damageChip(null, failDamage)],
            data: { caseNumber: number, damage: failDamage },
          });
        }
        main.data = checkData;
      } else {
        main.changes.push(...locationChanges, ...raise.changes);
        main.data = checkData;
        if (input.action === 'recheck_pass') {
          const found = await loadOpenCase();
          caseStatements.push(
            closeCaseStmt(env.DB, found.id.trim(), 'good', input.occurredOn, now),
          );
          set.open_case_id = '';
          main.data = { ...checkData, caseNumber: found.number, outcome: 'good' };
        } else if (damage !== undefined) {
          // Kasus tetap terbuka; kerusakan opsional diperbarui.
          const found = await loadOpenCase();
          if (found.damage !== damage) {
            caseStatements.push(updateCaseDamageStmt(env.DB, found.id.trim(), damage, now));
            main.changes.push(damageChip(found.damage, damage));
          }
          main.data = { ...checkData, caseNumber: found.number, damage };
        }
      }
      break;
    }
    default:
      // `note` dan `attempt_repair`: hanya kejadian (dan perubahan status untuk perbaikan).
      break;
  }

  // Klaim gambar pada pesan (pemilik `serial`, mengikuti BU serial); gambar milik pemilik lain = VALIDATION.
  const attach = await planAttachFiles(
    env,
    extractFileRefs(input.message),
    'serial',
    serialId,
    undefined,
    user.email,
  );

  // Pendengar antrean (surel rusak) dipasang ke batch yang sama: aksi yang batal tak meninggalkan job.
  const listeners: DbStatement[] =
    input.action === 'declare_broken'
      ? await statementsFor(env, 'serial.declared_broken', {
          serialId,
          caseId: openCaseId,
          eventId,
          now,
        })
      : [];

  const statements: DbStatement[] = [
    // Penghitung nomor LP SELALU di depan: rebutan muncul sebagai kegagalan penjaganya (diulang), bukan duplikat nomor.
    ...counterStatements,
    updateSerialStmt(env.DB, {
      id: serialId,
      expectedUpdatedAt: row.updated_at,
      now,
      actorEmail: user.email,
      set,
    }),
    ...caseStatements,
    ...[main, ...extraEvents].map((event) =>
      insertNextEventStmt(env.DB, {
        id: event.id,
        serialId,
        caseId: event.caseId,
        type: event.type,
        occurredOn: input.occurredOn,
        now,
        actorId: user.userId ?? '',
        actorName: user.name,
        actorTeam: flow.team,
        message: event.message,
        changes: event.changes,
        data: event.data,
      }),
    ),
    ...tail,
    ...attach,
    ...listeners,
  ];
  if (withCase) {
    // Galat mentah (penjaga/duplikat nomor) dinilai `runWithCaseNumber`, bukan dipetakan menjadi CONFLICT di sini.
    await env.DB.batch(statements);
  } else {
    await batchGuarded(env.DB, statements, SERIAL_CONFLICTS, STALE_MESSAGE);
  }
}
