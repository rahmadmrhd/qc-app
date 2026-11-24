import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { type AppError, appError, isAppError } from '@server/core/errors';
import { statementsFor } from '@server/core/events';
import { newId } from '@server/core/id';
import { type PlanOutcome, runRecordBatch } from '@server/core/record-batch';
import type { UserContext } from '@server/modules/access/context';
import type { ApplyStickersBatchInput, ApplyStickersBatchOutput } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import { resolveAction } from '@shared/serial-flow';
import {
  SERIAL_CUSTODIES,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialStatus,
} from '@shared/serials';
import { assertSerialVisible, modulesOn } from './access';
import { stickersAppliedEffect } from './act';
import { insertNextEventStmt, loadSerialRow, updateSerialStmt } from './repo';
import { nextStamp, STALE_MESSAGE, validationError } from './service';

// Tempel stiker massal (`serials.applyStickersBatch`, keputusan pemilik 2026-11-22 K1/K2): SATU `batch()` atomik lewat
// `runRecordBatch` (satu baris gagal = tidak ada yang tertulis), perencana per baris memakai `stickersAppliedEffect`
// yang sama dengan `serials.act` `apply_stickers`. Idempoten lewat `serial_events.client_id = <clientId>:<serialId>`:
// kiriman ulang permintaan yang sama tidak menulis kejadian maupun memotong stok dua kali.
//
// Keputusan kiriman ulang dalam satu percobaan HANYA datang dari `assertReplayConsistent` (satu pemeriksaan per percobaan
// sebelum perencana): ada kejadian dan identik = semua baris `unchanged`; tidak ada = permintaan baru. Bila perencana
// kemudian melihat kejadian ber-`clientId` itu (atau penulisan menabrak indeks uniknya), permintaan lain berkomit di
// antaranya = BALAPAN: percobaan diulang dari awal agar pemeriksaan itu yang memutuskan. Invarian "satu clientId = satu
// permintaan" dijaga klien: dua permintaan ber-clientId sama dengan himpunan serial yang saling lepas keduanya berkomit
// (kunci kejadian berbeda); server hanya menjamin per baris (tiap serial ditulis sekali, stok terpotong sekali).

const STATUS_SET: readonly string[] = SERIAL_STATUSES;
const CUSTODY_SET: readonly string[] = SERIAL_CUSTODIES;
const NOT_FOUND = 'Serial Number tidak ditemukan';
/** Pesan penanda balapan kirim ulang serentak: kejadian dengan `client_id` yang sama baru ditulis penulis lain. */
const CLIENT_ID_RACE = 'Permintaan ini sedang diproses';
/** Batas percobaan penuh bila permintaan ber-`clientId` sama berbalapan; habis = `CONFLICT` generik (penanda tak bocor). */
const MAX_REPLAYS = 3;

const asStatus = (value: string): SerialStatus =>
  (STATUS_SET.includes(value.trim()) ? value.trim() : 'good') as SerialStatus;
const asCustody = (value: string): SerialCustody =>
  (CUSTODY_SET.includes(value.trim()) ? value.trim() : 'qc') as SerialCustody;

/**
 * Galat perencana (`VALIDATION`/`CONFLICT`/`FORBIDDEN`) diberi awalan nomor serialnya agar pengguna tahu baris mana yang
 * membatalkan seluruh permintaan. Galat basi tetap generik (tanpa awalan) dan bendera `stale`-nya dipertahankan.
 */
function withSerial(error: unknown, serial: string): unknown {
  if (!isAppError(error) || error.stale) return error;
  if (error.code !== 'VALIDATION' && error.code !== 'CONFLICT' && error.code !== 'FORBIDDEN') {
    return error;
  }
  // `fields` sengaja dibuang: namanya (mis. `stickerIds`) bukan field masukan batch tingkat atas, dan menyalin nilainya
  // membuat pesan yang sama tampil dua kali di UI ("AB02: X: X").
  const wrapped: AppError = appError(error.code, `${serial}: ${error.message}`);
  return wrapped;
}

const REPLAY_CONFLICT = 'Permintaan ini sudah dipakai';

function storedStickerIds(dataJson: string): Set<string> {
  try {
    const data = JSON.parse(dataJson) as { stickers?: { stickerId?: unknown }[] };
    return new Set(
      (data.stickers ?? []).flatMap((sticker) =>
        typeof sticker.stickerId === 'string' ? [sticker.stickerId] : [],
      ),
    );
  } catch {
    return new Set();
  }
}

/**
 * Kiriman ulang dengan `clientId` yang sudah ada harus IDENTIK (pola idempotensi batch proyek, seperti entri stok
 * batch): kejadian tersimpan harus tepat satu per baris permintaan, milik pelaku yang sama, dengan himpunan stiker,
 * tanggal, dan catatan yang sama. Selain itu (milik orang lain, isi berbeda, atau hanya sebagian ada) = `CONFLICT`
 * generik. Mengembalikan `true` bila kejadiannya ada dan identik (kiriman ulang sah), `false` bila belum ada (permintaan baru).
 */
async function assertReplayConsistent(
  env: Env,
  input: ApplyStickersBatchInput,
  user: UserContext,
): Promise<boolean> {
  const { results } = await env.DB.prepare(
    'SELECT serial_id, actor_id, occurred_on, message, data_json FROM serial_events WHERE client_id LIKE ?',
  )
    .bind(`${input.clientId}:%`)
    .all<{
      serial_id: string;
      actor_id: string;
      occurred_on: string;
      message: string;
      data_json: string;
    }>();
  if (results.length === 0) return false;
  const wanted = new Map(input.rows.map((row) => [row.id, new Set(row.stickerIds)]));
  if (results.length !== wanted.size) throw appError('CONFLICT', REPLAY_CONFLICT);
  for (const event of results) {
    const stickers = wanted.get(event.serial_id.trim());
    const stored = storedStickerIds(event.data_json);
    const same =
      stickers !== undefined &&
      event.actor_id.trim() === (user.userId ?? '') &&
      event.occurred_on.trim() === input.occurredOn &&
      event.message === input.message &&
      stored.size === stickers.size &&
      [...stickers].every((stickerId) => stored.has(stickerId));
    if (!same) throw appError('CONFLICT', REPLAY_CONFLICT);
  }
  return true;
}

/** Penanda balapan: dilempar di luar pembungkus `withSerial` agar `fields.clientId` utuh dan loop luar mengulang. */
const raceError = (): AppError =>
  appError('CONFLICT', CLIENT_ID_RACE, { clientId: CLIENT_ID_RACE });

export async function applyStickersBatch(
  env: Env,
  input: ApplyStickersBatchInput,
  user: UserContext,
): Promise<ApplyStickersBatchOutput> {
  const today = wibDateIso(nowOf(env));
  if (input.occurredOn > today) {
    throw validationError('occurredOn', 'Tanggal tidak boleh di masa depan');
  }
  const stickersOf = new Map(input.rows.map((row) => [row.id, row.stickerIds]));
  let attempts = 0;
  /** Stiker yang disentuh perencana percobaan ini (dikosongkan tiap percobaan); diselesaikan sekali di akhir batch. */
  const touched = new Set<string>();
  /** Pemeriksaan kiriman ulang percobaan ini (satu per percobaan, dibagi semua perencana; dikosongkan di `prepare`). */
  let consistency: Promise<boolean> | null = null;

  const plan = async (id: string): Promise<PlanOutcome<string>> => {
    // Diulang di AWAL tiap percobaan CAS (bukan hanya sekali sebelum `runRecordBatch`): permintaan lain ber-clientId sama
    // dapat berkomit di antara percobaan, dan percobaan ulang harus melihatnya.
    consistency ??= assertReplayConsistent(env, input, user);
    const isReplay = await consistency;
    // Kiriman ulang sah (semua kejadian ada dan identik): hasil tersimpan dikembalikan SEBELUM hak/keberadaan serial
    // diperiksa ulang. Komit pertama sudah memeriksanya; serial yang kemudian dihapus atau keluar dari cakupan pengguna
    // tak boleh menggagalkan kiriman ulang (pengguna mengira gagal lalu mengirim dengan `clientId` baru = stok terpotong
    // dua kali). Keputusan pemilik 2026-11-23.
    if (isReplay) return { unchanged: id };
    const row = await loadSerialRow(env.DB, id);
    if (!row) throw appError('NOT_FOUND', NOT_FOUND);
    const buId = row.bu_id.trim();
    assertSerialVisible(user, buId);
    const serialId = row.id.trim();
    const eventClientId = `${input.clientId}:${serialId}`;
    // Pemeriksaan tadi tidak menemukan kejadian, tetapi kini ada: permintaan lain berkomit di antaranya = balapan.
    const raced = await env.DB.prepare('SELECT 1 AS found FROM serial_events WHERE client_id = ?')
      .bind(eventClientId)
      .first<{ found: number }>();
    if (raced) throw raceError();
    try {
      const resolved = resolveAction(
        'apply_stickers',
        { status: asStatus(row.status), custody: asCustody(row.custody) },
        modulesOn(user, buId),
      );
      if ('error' in resolved) {
        throw resolved.error === 'state'
          ? appError(
              'CONFLICT',
              'Aksi ini tidak bisa dilakukan pada keadaan Serial Number sekarang',
            )
          : appError('FORBIDDEN', 'Aksi ini bukan bagian tim kamu');
      }
      const now = nextStamp(nowIso(env), row.updated_at);
      const eventId = newId();
      const effect = await stickersAppliedEffect(
        env,
        row,
        eventId,
        row.location_id.trim(),
        row.location_name ?? '',
        stickersOf.get(id) ?? [],
        user,
        now,
        attempts > 1,
        // Stiker `deprecated` dipakai sampai habis lintas serial: penonaktifannya ditunda ke akhir batch (`trailing`).
        true,
      );
      for (const stickerId of stickersOf.get(id) ?? []) touched.add(stickerId);
      return {
        dto: serialId,
        stmts: [
          updateSerialStmt(env.DB, {
            id: serialId,
            expectedUpdatedAt: row.updated_at,
            now,
            actorEmail: user.email,
            set: {},
          }),
          insertNextEventStmt(env.DB, {
            id: eventId,
            serialId,
            caseId: row.open_case_id.trim(),
            type: 'stickers_applied',
            occurredOn: input.occurredOn,
            now,
            actorId: user.userId ?? '',
            actorName: user.name,
            actorTeam: resolved.row.team,
            message: input.message,
            changes: effect.changes,
            data: effect.data,
            clientId: eventClientId,
          }),
          ...effect.tail,
        ],
      };
    } catch (error) {
      throw withSerial(error, row.serial);
    }
  };

  for (let replay = 0; ; replay++) {
    attempts = 0;
    try {
      const { items } = await runRecordBatch(
        env,
        input.rows.map((row) => row.id),
        plan,
        {
          conflicts: { serial_events_client_id: { message: CLIENT_ID_RACE, field: 'clientId' } },
          stale: STALE_MESSAGE,
          prepare: () => {
            attempts++;
            touched.clear();
            consistency = null;
          },
          trailing: () =>
            statementsFor(env, 'serial.stickers_settled', {
              stickerIds: [...touched],
              actor: user.email,
              now: nowIso(env),
            }),
        },
      );
      return { ids: items };
    } catch (error) {
      const race =
        isAppError(error) && error.code === 'CONFLICT' && error.fields?.clientId === CLIENT_ID_RACE;
      if (race && replay < MAX_REPLAYS - 1) continue;
      // Penanda balapan tak boleh bocor ke klien sebagai galat final.
      if (race) throw appError('CONFLICT', REPLAY_CONFLICT);
      throw error;
    }
  }
}
