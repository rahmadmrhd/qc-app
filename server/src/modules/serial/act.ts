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
import { type FlowRow, resolveAction, SERIAL_FLOW, sendLegOf } from '@shared/serial-flow';
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
import { planProofAttach } from './proof/attach';
import './alert-listener';
import { applicableStickersOf } from './applicable';
import {
  closeCaseStmt,
  insertCaseStmt,
  loadCase,
  reserveCaseNumber,
  runWithCaseNumber,
  setCaseOriginStmt,
} from './case-repo';
import { daysBetween } from './dates';
import {
  activeLocationName,
  insertNextEventStmt,
  loadSerialRow,
  loadSerialStickers,
  locationNameOf,
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
import { effectiveServiceLocations } from './service-locations';

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
  team?: 'qc' | 'service';
}

interface StickerRaise {
  /** `serial_stickers` upsert dan pendengar stok (`serial.stickers_added`), dipasang ke batch aksi. */
  statements: DbStatement[];
  changes: SerialChangeDto[];
  raised: { stickerId: string; name: string; qtyFrom: number; qtyTo: number }[];
}

/**
 * Stiker yang DICENTANG pada cek ulang (rancangan §4.2): tiap id menambah 1 pada jumlah tempel serial itu (termasuk stiker
 * yang belum pernah ditempel) dan memotong stok 1 di `locationId` lewat pendengar `serial.stickers_added` dalam batch yang
 * sama. Stiker `inactive` tidak dapat dicentang (`deprecated` boleh, spek §3 butir 24); stiker baru harus berlaku bagi item
 * pada BU serial.
 */
async function stickerRaise(
  env: Env,
  row: SerialRow,
  eventId: string,
  locationId: string,
  stickerIds: readonly string[],
  user: UserContext,
  now: string,
  retried: boolean,
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
  const unknown = stickerIds.filter((stickerId) => !current.has(stickerId));
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
  for (const stickerId of stickerIds) {
    const existing = current.get(stickerId);
    if (existing && existing.status === 'inactive') {
      // Percobaan ke-2 dan seterusnya hanya terjadi setelah batch dibatalkan penjaga; stiker yang baru terlihat nonaktif
      // berarti dinonaktifkan serentak (spek §3 butir 24): jawab usang (CONFLICT/412), bukan VALIDATION. Stiker yang
      // SUDAH nonaktif sebelum permintaan tetap VALIDATION pada field `stickerIds` (percobaan pertama).
      if (retried) throw staleError(STALE_MESSAGE);
      throw validationError('stickerIds', 'Stiker nonaktif tidak bisa ditempel');
    }
    if (!existing && !applicable.has(stickerId)) {
      throw validationError('stickerIds', 'Stiker tidak berlaku bagi item ini');
    }
    const from = existing?.qty ?? 0;
    const to = from + 1;
    const name = existing?.name ?? applicable.get(stickerId)?.name ?? '';
    picks.push({ stickerId, qty: 1 });
    raised.push({ stickerId, name, qtyFrom: from, qtyTo: to });
    changes.push({
      field: 'stickers',
      from: stickerChip(name, existing ? from : null),
      to: stickerChip(name, to),
    });
    statements.push(upsertSerialStickerStmt(env.DB, serialId, stickerId, to));
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

/** Aksi yang membuka laporan baru (membutuhkan nomor LP dari penghitung CAS). */
function opensCase(input: SerialActInput): boolean {
  return (
    input.action === 'report_failure' || (input.action === 'recheck' && input.result === 'fail')
  );
}

/** Aksi yang, dari kustodi `transit`, didahului Terima otomatis (diagnosis/Rusak oleh servis, cek ulang oleh QC). */
const AUTO_RECEIVE_ACTIONS: readonly string[] = [
  'service_diagnosis',
  'declare_broken',
  'recheck_pass',
  'recheck_fail',
];

/**
 * `serials.act` (tabel di `shared/serial-flow.ts`). Urutan galat: (1) bentuk, termasuk tanggal masa depan;
 * (2) serial tak ada atau BU di luar hak baca = `NOT_FOUND`; (3) `updated_at` usang = stale; (4) aksi tak ada untuk
 * keadaan serial = `CONFLICT`; (5) ada tetapi modul pelaku tak cukup = `FORBIDDEN`; (6) rujukan tak sah = `VALIDATION`.
 * Semua efek (serial, laporan, kejadian termasuk Terima otomatis, stok, klaim berkas, job surel) ditulis dalam SATU
 * `batch()`. Seluruh muat keadaan -> susun -> tulis diulang bila penghitung nomor LP diperebutkan (`runWithCaseNumber`),
 * jadi semua kondisi dihitung ulang pada tiap percobaan.
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
  let tries = 0;
  const attempt = () => applyAct(env, input, user, today, withCase, tries++ > 0);
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
  retried: boolean,
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
    input.action === 'service_diagnosis' ? input.stage : undefined,
  );
  if ('error' in resolved) {
    throw resolved.error === 'state'
      ? appError('CONFLICT', 'Aksi ini tidak bisa dilakukan pada keadaan Serial Number sekarang')
      : appError('FORBIDDEN', 'Aksi ini bukan bagian tim kamu');
  }
  const flow: FlowRow = resolved.row;
  const toLocationInput =
    (input.action === 'send' || input.action === 'receive') && input.toLocationId !== undefined
      ? input.toLocationId
      : undefined;

  const now = nextStamp(nowIso(env), row.updated_at);
  const set: Partial<Record<SerialColumn, string | number>> = {};
  const counterStatements: DbStatement[] = [];
  const caseStatements: DbStatement[] = [];
  const tail: DbStatement[] = [];
  const preEvents: EventDraft[] = [];
  const extraEvents: EventDraft[] = [];

  const openCaseId = row.open_case_id.trim();
  const eventId = crypto.randomUUID();
  const newCaseId = crypto.randomUUID();
  let currentLocationId = row.location_id.trim();
  let currentLocationName = row.location_name ?? '';

  const loadOpenCase = async () => {
    const found = openCaseId === '' ? null : await loadCase(env.DB, openCaseId);
    if (!found) throw appError('CONFLICT', 'Laporan untuk Serial Number ini tidak ditemukan');
    return found;
  };
  /** Membuka laporan baru: nomor LP dipesan dan penjaganya ikut batch (selalu paling depan). */
  const openNewCase = async (): Promise<string> => {
    const reservation = await reserveCaseNumber(env, today.replaceAll('-', ''));
    counterStatements.push(...reservation.statements);
    caseStatements.push(
      insertCaseStmt(env.DB, {
        id: newCaseId,
        number: reservation.number,
        serialId,
        buId,
        openedOn: input.occurredOn,
        originLocationId: currentLocationId,
        now,
        actorEmail: user.email,
      }),
    );
    set.open_case_id = newCaseId;
    return reservation.number;
  };

  // Terima otomatis: diagnosis/Rusak dari kustodi `transit` (atau cek ulang dari `transit`) menulis kejadian `receive`
  // lebih dulu (aturan Terima biasa: tanggal tidak sebelum tanggal kirim), lalu kejadian aksinya, dalam batch yang sama.
  let midCustody: SerialCustody = custody;
  if (custody === 'transit' && AUTO_RECEIVE_ACTIONS.includes(input.action)) {
    if (row.transit_on !== '' && input.occurredOn < row.transit_on) {
      throw validationError('occurredOn', 'Tanggal terima tidak boleh sebelum tanggal kirim');
    }
    const leg = sendLegOf('receive', status);
    const receiveRow = SERIAL_FLOW.find((entry) => entry.action === 'receive' && entry.leg === leg);
    midCustody = receiveRow && receiveRow.toCustody !== 'same' ? receiveRow.toCustody : custody;
    const targetId = row.transit_to_location_id.trim();
    // Unit tidak boleh mendarat otomatis di lokasi nonaktif (Terima biasa juga menolaknya; keputusan pemilik 2026-11-14).
    if (targetId !== '' && (await activeLocationName(env.DB, targetId)) === null) {
      throw validationError('action', 'Terima dulu unitnya di lokasi aktif');
    }
    const targetName = row.transit_to_name ?? currentLocationName;
    const changes: SerialChangeDto[] = [
      {
        field: 'custody',
        from: SERIAL_CUSTODY_LABELS[custody],
        to: SERIAL_CUSTODY_LABELS[midCustody],
      },
    ];
    if (targetId !== '' && targetId !== currentLocationId) {
      set.location_id = targetId;
      changes.push({ field: 'location', from: currentLocationName, to: targetName });
      currentLocationId = targetId;
      currentLocationName = targetName;
    }
    set.transit_from_location_id = '';
    set.transit_to_location_id = '';
    set.transit_on = '';
    preEvents.push({
      id: crypto.randomUUID(),
      caseId: openCaseId,
      type: 'receive',
      message: '',
      changes,
      data: {
        leg,
        auto: true,
        fromLocationName: row.transit_from_name ?? '',
        toLocationName: targetName,
        daysInTransit: daysBetween(row.transit_on, input.occurredOn),
      },
      team: flow.team,
    });
  }

  // Perubahan status/posisi, dipasang pada kejadian utama aksi (dihitung dari keadaan sesudah Terima otomatis).
  const stateChanges: SerialChangeDto[] = [];
  const newStatus = flow.toStatus === 'same' ? status : flow.toStatus;
  const newCustody = flow.toCustody === 'same' ? midCustody : flow.toCustody;
  if (newStatus !== status) {
    set.status = newStatus;
    stateChanges.push({
      field: 'status',
      from: SERIAL_STATUS_LABELS[status],
      to: SERIAL_STATUS_LABELS[newStatus],
    });
  }
  if (newCustody !== custody) set.custody = newCustody;
  if (newCustody !== midCustody) {
    stateChanges.push({
      field: 'custody',
      from: SERIAL_CUSTODY_LABELS[midCustody],
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

  switch (input.action) {
    case 'report_failure': {
      const number = await openNewCase();
      main.caseId = newCaseId;
      main.data = { caseNumber: number };
      break;
    }
    case 'service_diagnosis': {
      const found = await loadOpenCase();
      main.data = { caseNumber: found.number, stage: input.stage };
      if (input.stage === 'done') {
        // Kembali ke QC: tujuan = lokasi QC asal laporan (diisi saat dilaporkan dan diperbarui saat Kirim ke servis);
        // kosong (data lama) = lokasi unit sekarang.
        const destinationId = found.origin_location_id.trim() || currentLocationId;
        const destinationName = (await locationNameOf(env.DB, destinationId)) ?? '';
        set.transit_from_location_id = currentLocationId;
        set.transit_to_location_id = destinationId;
        set.transit_on = input.occurredOn;
        main.data = {
          ...main.data,
          leg: 'to_qc',
          fromLocationId: currentLocationId,
          fromLocationName: currentLocationName,
          toLocationId: destinationId,
          toLocationName: destinationName,
        };
      }
      break;
    }
    case 'declare_broken': {
      const found = await loadOpenCase();
      caseStatements.push(closeCaseStmt(env.DB, found.id.trim(), 'broken', input.occurredOn, now));
      set.open_case_id = '';
      main.data = { caseNumber: found.number, outcome: 'broken' };
      break;
    }
    case 'send': {
      // Daftar tujuan = lokasi servis efektif (konfigurasi). Satu lokasi: dipakai otomatis; banyak: wajib dipilih dan
      // harus termasuk daftar. Kirim dari lokasi yang sama dengan tujuan sah (QC dan servis boleh sama lokasi).
      const options = await effectiveServiceLocations(env);
      if (options.length === 0) {
        throw validationError('toLocationId', 'Belum ada lokasi servis yang aktif');
      }
      let target = options.length === 1 ? options[0] : undefined;
      if (toLocationInput !== undefined) {
        target = options.find((option) => option.id === toLocationInput);
        if (!target) throw validationError('toLocationId', 'Lokasi tujuan bukan lokasi servis');
      }
      if (!target) throw validationError('toLocationId', 'Pilih dulu lokasi servis tujuannya');
      const found = await loadOpenCase();
      caseStatements.push(setCaseOriginStmt(env.DB, found.id.trim(), currentLocationId, now));
      set.transit_from_location_id = currentLocationId;
      set.transit_to_location_id = target.id;
      set.transit_on = input.occurredOn;
      main.data = {
        leg: flow.leg,
        caseNumber: found.number,
        fromLocationId: currentLocationId,
        fromLocationName: currentLocationName,
        toLocationId: target.id,
        toLocationName: target.name,
        // Catatan pengiriman opsional (ekspedisi, resi, pengantar); kosong tidak disimpan.
        ...(input.action === 'send' && input.shipmentNote
          ? { shipmentNote: input.shipmentNote }
          : {}),
      };
      break;
    }
    case 'receive': {
      // Keputusan pemilik 2026-11-13: tanggal terima tidak boleh mendahului tanggal kirim (ISO, jadi perbandingan teks sah).
      if (row.transit_on !== '' && input.occurredOn < row.transit_on) {
        throw validationError('occurredOn', 'Tanggal terima tidak boleh sebelum tanggal kirim');
      }
      let targetId = row.transit_to_location_id.trim();
      let targetName = row.transit_to_name ?? currentLocationName;
      if (flow.leg === 'at_qc') {
        // Terima di QC memulihkan lokasi QC asal; hanya bila lokasi itu sudah nonaktif, pengguna memilih lokasi aktif lain.
        const originActive =
          targetId !== '' && (await activeLocationName(env.DB, targetId)) !== null;
        if (originActive) {
          if (toLocationInput !== undefined && toLocationInput !== targetId) {
            throw validationError('toLocationId', 'Lokasi sudah ditentukan dari lokasi QC asal');
          }
        } else {
          if (toLocationInput === undefined) {
            throw validationError(
              'toLocationId',
              'Lokasi QC asal sudah tidak aktif, pilih lokasi penerimaan',
            );
          }
          const chosen = await activeLocationName(env.DB, toLocationInput);
          if (chosen === null) throw validationError('toLocationId', LOCATION_MESSAGE);
          targetId = toLocationInput;
          targetName = chosen;
        }
      } else if (toLocationInput !== undefined) {
        throw validationError('toLocationId', 'Lokasi tidak bisa dipilih saat menerima di servis');
      }
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
      // Lokasi cek ulang = lokasi unit (sesudah Terima otomatis bila `transit`).
      const raise = await stickerRaise(
        env,
        row,
        eventId,
        currentLocationId,
        input.stickerIds ?? [],
        user,
        now,
        retried,
      );
      tail.push(...raise.statements);
      const checkData: Record<string, unknown> = {
        locationId: currentLocationId,
        locationName: currentLocationName,
      };
      if (raise.raised.length > 0) checkData.stickers = raise.raised;

      if (input.action === 'recheck') {
        const result = input.result ?? 'pass';
        checkData.result = result;
        if (result === 'pass') {
          main.changes.push(...raise.changes);
          main.data = checkData;
        } else {
          // Serial Lolos yang cek ulangnya gagal: kejadian `recheck` (membawa stiker) lalu `report_failure` yang
          // membawa catatan laporan; keduanya masuk lingkup laporan baru.
          const number = await openNewCase();
          main.caseId = newCaseId;
          main.message = '';
          main.changes = [...raise.changes];
          main.data = { ...checkData, caseNumber: number };
          extraEvents.push({
            id: crypto.randomUUID(),
            caseId: newCaseId,
            type: 'report_failure',
            message: input.message,
            changes: [...stateChanges],
            data: { caseNumber: number },
          });
        }
      } else {
        main.changes.push(...raise.changes);
        const found = await loadOpenCase();
        if (input.action === 'recheck_pass') {
          caseStatements.push(
            closeCaseStmt(env.DB, found.id.trim(), 'good', input.occurredOn, now),
          );
          set.open_case_id = '';
          main.data = { ...checkData, caseNumber: found.number, outcome: 'good' };
        } else {
          // Laporan tetap terbuka.
          main.data = { ...checkData, caseNumber: found.number, result: 'fail' };
        }
      }
      break;
    }
    default:
      // `note`: hanya kejadian.
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

  // Foto bukti QC cek ulang: klaim ber-CAS + job cap di batch yang sama dengan kejadian utama. Lokasi cap = lokasi serial
  // SESUDAH kejadian (cek ulang dari `transit` memakai lokasi tujuan lewat Terima otomatis di atas).
  const proofStatements = await planProofAttach(
    env,
    'proofPhotoIds' in input ? input.proofPhotoIds : undefined,
    {
      user,
      serialId,
      eventId,
      snapshot: {
        serial: row.serial,
        brand: row.brand_name ?? '',
        model: (row.model ?? '').trim(),
        buCode: row.bu_code.trim(),
        locationName: currentLocationName,
        actorName: user.name,
        actorTeam: flow.team === 'service' ? 'service' : 'qc',
      },
      now,
    },
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
    ...[...preEvents, main, ...extraEvents].map((event) =>
      insertNextEventStmt(env.DB, {
        id: event.id,
        serialId,
        caseId: event.caseId,
        type: event.type,
        occurredOn: input.occurredOn,
        now,
        actorId: user.userId ?? '',
        actorName: user.name,
        actorTeam: event.team ?? flow.team,
        message: event.message,
        changes: event.changes,
        data: event.data,
      }),
    ),
    ...tail,
    ...attach,
    ...listeners,
    ...proofStatements,
  ];
  if (withCase) {
    // Galat mentah (penjaga/duplikat nomor) dinilai `runWithCaseNumber`, bukan dipetakan menjadi CONFLICT di sini.
    await env.DB.batch(statements);
  } else {
    await batchGuarded(env.DB, statements, SERIAL_CONFLICTS, STALE_MESSAGE);
  }
}
