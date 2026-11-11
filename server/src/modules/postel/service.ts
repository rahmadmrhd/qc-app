import { writeAudit } from '@server/core/audit';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, staleError as coreStaleError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
import { visibleBuIds } from '@server/modules/item/access';
import { itemIdsVisibleIn } from '@server/modules/item/repo';
import { guardChanged, runGuardedBatch } from '@server/modules/qrcode/repo';
import { ensurePostelSticker } from '@server/modules/sticker/postel';
import type {
  PostelDto,
  PostelListDto,
  PostelNumberDto,
  PostelSummaryDto,
  SavePostelInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import {
  daysUntil,
  POSTEL_ALERT_DEFAULTS,
  POSTEL_LIMITS,
  postelCondition,
  postelName,
  postelRoles,
  wibDateIso,
} from '@shared/postel';
import { postelSnapshot, postelTarget } from './audit';
import {
  claimItemsForPostelStmts,
  findPostelItemsById,
  listItemsOfPostels,
  type PostelItem,
  releaseAllItemsFromPostelStmt,
  releaseItemsFromPostelStmt,
} from './items';
import {
  deletePostelNumberStmt,
  deletePostelNumbersOfStmt,
  deletePostelStmt,
  findPostelRecord,
  insertPostelNumberStmt,
  insertPostelStmt,
  listPostelNumbers,
  listPostelRecords,
  lockPostelRowStmt,
  type PostelNumberRecord,
  type PostelRecord,
  updatePostelNumberStmt,
  updatePostelStmt,
} from './repo';

export { queryPostelItemOptions } from './items';

export const POSTEL_STALE_MESSAGE =
  'Postel sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

/** Kunci pengaturan peringatan Postel di tabel `settings` (JSON; dikelola Konfigurasi Stiker). */
export const SETTING_POSTEL_ALERT = 'POSTEL_ALERT';

/** Bentrok indeks unik nomor sertifikat; pesan generik (tidak memuat catatan pemilik nomor itu). */
const POSTEL_CONFLICTS = {
  postel_numbers_key: { field: 'number', message: 'Nomor sertifikat sudah dipakai' },
};

function staleError(): Error {
  return coreStaleError(POSTEL_STALE_MESSAGE);
}

function fieldFail(field: string, message: string, code: 'VALIDATION' | 'CONFLICT' = 'VALIDATION') {
  return appError(code, message, { [field]: message });
}

/**
 * Ambang "segera habis" = ambang peringatan terbesar di `POSTEL_ALERT`. Pembacaan LONGGAR: pengaturan belum ada,
 * bukan JSON, atau tanpa ambang sah memakai `POSTEL_ALERT_DEFAULTS` (tampilan tak boleh gagal karena pengaturan rusak).
 */
export async function postelSoonDays(env: Env): Promise<number> {
  const fallback = Math.max(...POSTEL_ALERT_DEFAULTS.thresholds);
  const raw = await getSetting(env, SETTING_POSTEL_ALERT);
  if (raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw) as { thresholds?: unknown } | null;
    const thresholds = parsed?.thresholds;
    if (!Array.isArray(thresholds)) return fallback;
    const valid = thresholds.filter(
      (value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0,
    );
    return valid.length > 0 ? Math.max(...valid) : fallback;
  } catch {
    return fallback;
  }
}

/** Waktu tulis baru yang SELALU lebih besar dari `previous` (agar penjaga `updated_at` tak terkecoh jam yang sama). */
function nextUpdatedAt(env: Env, previous: string): string {
  const now = nowIso(env);
  if (previous === '' || now > previous) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

/** Data baca satu atau banyak catatan: nomor, item, dan himpunan item yang terlihat bagi pembaca. */
interface PostelRead {
  records: PostelRecord[];
  numbers: Map<string, PostelNumberRecord[]>;
  items: Map<string, PostelItem[]>;
  visible: Set<string>;
  soonDays: number;
  today: string;
}

async function readPostels(
  env: Env,
  user: UserContext,
  records: PostelRecord[],
  ids?: readonly string[],
): Promise<PostelRead> {
  const [numberRows, items, soonDays] = await Promise.all([
    listPostelNumbers(env.DB, ids),
    listItemsOfPostels(env.DB, ids),
    postelSoonDays(env),
  ]);
  const numbers = new Map<string, PostelNumberRecord[]>();
  for (const row of numberRows) {
    const list = numbers.get(row.postelId) ?? [];
    list.push(row);
    numbers.set(row.postelId, list);
  }
  const visible = await itemIdsVisibleIn(
    env.DB,
    [...items.values()].flatMap((list) => list.map((item) => item.id)),
    visibleBuIds(user),
  );
  return { records, numbers, items, visible, soonDays, today: wibDateIso(nowOf(env)) };
}

function numberDtos(
  numbers: readonly PostelNumberRecord[],
  soonDays: number,
  today: string,
): PostelNumberDto[] {
  const roles = postelRoles(numbers.map((entry) => entry.seq));
  return numbers.map((entry, index) => {
    const daysLeft = daysUntil(entry.expiresOn, today);
    return {
      id: entry.id,
      number: entry.number,
      expiresOn: entry.expiresOn,
      link: entry.link,
      role: roles[index] ?? 'old',
      condition: postelCondition(daysLeft, soonDays),
      daysLeft,
    };
  });
}

function postelNameOf(items: readonly PostelItem[]): string {
  return postelName(items.map((item) => item.model));
}

function toPostelDto(record: PostelRecord, read: PostelRead): PostelDto {
  const all = read.items.get(record.id) ?? [];
  const shown = all.filter((item) => read.visible.has(item.id));
  return {
    id: record.id,
    name: postelNameOf(all),
    note: record.note,
    numbers: numberDtos(read.numbers.get(record.id) ?? [], read.soonDays, read.today),
    items: shown.map((item) => ({ id: item.id, brand: item.brand, model: item.model })),
    itemCount: all.length,
    hiddenItemCount: all.length - shown.length,
    // Lampiran dibuka pada tugas berikutnya (berkas Postel); sampai itu daftar selalu kosong.
    attachments: [],
    today: read.today,
    soonDays: read.soonDays,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function toSummaryDto(record: PostelRecord, read: PostelRead): PostelSummaryDto {
  const numbers = read.numbers.get(record.id) ?? [];
  const active = numbers[numbers.length - 1];
  const daysLeft = active ? daysUntil(active.expiresOn, read.today) : 0;
  return {
    id: record.id,
    name: postelNameOf(read.items.get(record.id) ?? []),
    itemCount: (read.items.get(record.id) ?? []).length,
    activeNumber: active?.number ?? '',
    activeExpiresOn: active?.expiresOn ?? '',
    condition: active ? postelCondition(daysLeft, read.soonDays) : 'valid',
    daysLeft,
    oldNumberCount: Math.max(0, numbers.length - 1),
    updatedAt: record.updatedAt,
  };
}

/** Semua catatan (maks. 500), urut tanggal habis nomor Aktif menaik; penyaringan dan pencarian di klien. */
export async function listPostels(env: Env, user: UserContext): Promise<PostelListDto> {
  const records = await listPostelRecords(env.DB);
  const read = await readPostels(env, user, records);
  const summaries = records
    .map((record) => toSummaryDto(record, read))
    .sort(
      (a, b) =>
        (a.activeExpiresOn < b.activeExpiresOn
          ? -1
          : a.activeExpiresOn > b.activeExpiresOn
            ? 1
            : 0) ||
        a.name.localeCompare(b.name) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, POSTEL_LIMITS.listMax);
  return { postels: summaries, today: read.today, soonDays: read.soonDays };
}

async function loadPostelDto(env: Env, user: UserContext, id: string): Promise<PostelDto> {
  const record = await findPostelRecord(env.DB, id);
  if (!record) throw appError('NOT_FOUND', 'Postel tidak ditemukan');
  return toPostelDto(record, await readPostels(env, user, [record], [id]));
}

export async function getPostel(env: Env, user: UserContext, id: string): Promise<PostelDto> {
  return loadPostelDto(env, user, id);
}

/** Nomor Aktif (seq terbesar) catatan; `''` bila catatan tak punya nomor. */
async function activeNumberOf(env: Env, postelId: string): Promise<string> {
  const numbers = await listPostelNumbers(env.DB, [postelId]);
  return numbers[numbers.length - 1]?.number ?? '';
}

function itemTakenMessage(item: { brand: string; model: string }, activeNumber: string): string {
  return `Item "${item.brand} ${item.model}" sudah tergabung ke Postel "${activeNumber}"; keluarkan dulu dari sana`;
}

/**
 * Menulis catatan beserta nomor dan pemasangan item dalam SATU transaksi. Penjaga yang gagal (versi usang atau item yang
 * direbut catatan lain pada saat yang sama) membatalkan seluruhnya; bila penyebabnya item yang kini dimiliki catatan
 * lain, pesan menyebut nomor Aktif catatan itu. Nomor kembar (indeks unik) menjadi `CONFLICT` pada `number`.
 */
async function runPostelBatch(
  env: Env,
  statements: DbStatement[],
  postelId: string,
  claimedIds: readonly string[],
): Promise<void> {
  try {
    await runGuardedBatch(env.DB, statements, staleError);
  } catch (error) {
    const mapped = mapDuplicateError(error, POSTEL_CONFLICTS);
    if (mapped !== error) throw mapped;
    if (claimedIds.length > 0 && (error as { stale?: boolean }).stale === true) {
      const now = await findPostelItemsById(env.DB, claimedIds);
      const taken = claimedIds
        .map((id) => now.get(id))
        .find((item) => item !== undefined && item.postelId !== '' && item.postelId !== postelId);
      if (taken) {
        const message = itemTakenMessage(taken, await activeNumberOf(env, taken.postelId));
        throw appError('CONFLICT', message, { itemIds: message });
      }
    }
    throw error;
  }
}

/**
 * Menyimpan catatan Postel (PUT utuh): isi, nomor sertifikat, dan keanggotaan item. Item yang tak terlihat bagi
 * penyimpan (di luar BU-nya) tidak dapat dipilih atau dilepas dan tetap terpasang. Nomor Aktif (seq terbesar) hanya
 * hilang bila ada nomor baru; `seq` nomor baru = maks(seq tersimpan) + 1 berurutan.
 */
export async function savePostel(
  env: Env,
  input: SavePostelInput,
  actor: UserContext,
): Promise<PostelDto> {
  const existing = input.id ? await findPostelRecord(env.DB, input.id) : null;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Postel tidak ditemukan');
  if (existing && input.expectedUpdatedAt !== existing.updatedAt) throw staleError();

  // Nomor: baris ber-id harus milik catatan ini; baris baru mendapat seq berurutan di atas seq tersimpan.
  const stored = existing ? await listPostelNumbers(env.DB, [existing.id]) : [];
  const storedById = new Map(stored.map((entry) => [entry.id, entry]));
  for (const row of input.numbers) {
    if (row.id !== undefined && !storedById.has(row.id)) {
      throw fieldFail('numbers', 'Nomor tidak ditemukan pada catatan ini');
    }
  }
  const postelId = existing?.id ?? crypto.randomUUID();
  const updatedAt = nextUpdatedAt(env, existing?.updatedAt ?? '');
  let lastSeq = stored.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const finalNumbers: PostelNumberRecord[] = [];
  const insertedNumbers: PostelNumberRecord[] = [];
  const updatedNumbers: PostelNumberRecord[] = [];
  for (const row of input.numbers) {
    const previous = row.id === undefined ? undefined : storedById.get(row.id);
    if (previous) {
      if (
        previous.number === row.number &&
        previous.expiresOn === row.expiresOn &&
        previous.link === row.link
      ) {
        finalNumbers.push(previous);
        continue;
      }
      // Tanggal habis berubah (diperpanjang) = peringatan nomor ini mulai dari awal.
      const dateChanged = previous.expiresOn !== row.expiresOn;
      const next: PostelNumberRecord = {
        ...previous,
        number: row.number,
        numberKey: normalizeKey(row.number),
        expiresOn: row.expiresOn,
        link: row.link,
        alertSentThreshold: dateChanged ? null : previous.alertSentThreshold,
        alertSentOn: dateChanged ? '' : previous.alertSentOn,
        updatedAt,
        updatedBy: actor.email,
      };
      finalNumbers.push(next);
      updatedNumbers.push(next);
      continue;
    }
    lastSeq += 1;
    const created: PostelNumberRecord = {
      id: crypto.randomUUID(),
      postelId,
      number: row.number,
      numberKey: normalizeKey(row.number),
      expiresOn: row.expiresOn,
      link: row.link,
      seq: lastSeq,
      alertSentThreshold: null,
      alertSentOn: '',
      createdAt: updatedAt,
      updatedAt,
      updatedBy: actor.email,
    };
    finalNumbers.push(created);
    insertedNumbers.push(created);
  }
  const keptIds = new Set(finalNumbers.map((entry) => entry.id));
  const removedNumbers = stored.filter((entry) => !keptIds.has(entry.id));
  const finalMaxSeq = finalNumbers.reduce((max, entry) => Math.max(max, entry.seq), 0);
  // Hanya nomor Lama yang boleh dibuang: nomor Aktif (seq terbesar) tetap atau tergantikan nomor baru.
  if (removedNumbers.some((entry) => entry.seq >= finalMaxSeq)) {
    throw fieldFail('numbers', 'Nomor Aktif tidak dapat dihapus');
  }

  // Item: hanya yang terlihat bagi penyimpan yang boleh dipilih/dilepas; yang tak terlihat tetap terpasang.
  const owned = existing
    ? ((await listItemsOfPostels(env.DB, [existing.id])).get(existing.id) ?? [])
    : [];
  const ownedIds = new Set(owned.map((item) => item.id));
  const requested = input.itemIds;
  const fetched = await findPostelItemsById(env.DB, requested);
  const visible = await itemIdsVisibleIn(
    env.DB,
    [...requested, ...owned.map((item) => item.id)],
    visibleBuIds(actor),
  );
  for (const id of requested) {
    const item = fetched.get(id);
    // Item tak ada dan item di luar BU penyimpan dijawab sama (keberadaan item BU lain tidak bocor).
    if (!item || !visible.has(id)) throw fieldFail('itemIds', 'Item tidak ditemukan');
    if (item.postelId !== '' && item.postelId !== postelId) {
      throw fieldFail(
        'itemIds',
        itemTakenMessage(item, await activeNumberOf(env, item.postelId)),
        'CONFLICT',
      );
    }
    if (!ownedIds.has(id) && item.status !== 'active') {
      throw fieldFail(
        'itemIds',
        `Item "${item.brand} ${item.model}" nonaktif dan tidak dapat dipilih`,
      );
    }
  }
  const hiddenOwned = owned.filter((item) => !visible.has(item.id));
  const toAdd = requested.filter((id) => !ownedIds.has(id));
  const toRemove = owned
    .filter((item) => visible.has(item.id) && !requested.includes(item.id))
    .map((item) => item.id);
  const finalItemCount = hiddenOwned.length + requested.length;
  if (finalItemCount === 0) throw fieldFail('itemIds', 'Pilih minimal satu item');
  if (finalItemCount > POSTEL_LIMITS.itemsMax) {
    throw fieldFail('itemIds', `Maksimal ${POSTEL_LIMITS.itemsMax} item per catatan`);
  }

  const numbersChanged =
    insertedNumbers.length > 0 || updatedNumbers.length > 0 || removedNumbers.length > 0;
  if (
    existing &&
    existing.note === input.note &&
    !numbersChanged &&
    toAdd.length === 0 &&
    toRemove.length === 0
  ) {
    // Tanpa perubahan: tidak ada tulisan, audit, atau kenaikan `updatedAt` (versi yang dimuat orang lain tetap sah).
    return loadPostelDto(env, actor, existing.id);
  }

  // Jenis dan stiker Postel lahir malas saat catatan pertama disimpan; idempoten dan aman serentak.
  await ensurePostelSticker(env, actor);

  const next: PostelRecord = {
    id: postelId,
    note: input.note,
    // Lampiran dikelola tugas berikutnya; sementara larik tersimpan tak berubah.
    attachments: existing?.attachments ?? [],
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    updatedBy: actor.email,
  };
  const after = postelSnapshot(next, finalNumbers, finalItemCount, next.attachments.length);
  if (!existing) {
    await runPostelBatch(
      env,
      [
        insertPostelStmt(env.DB, next),
        ...insertedNumbers.map((entry) => insertPostelNumberStmt(env.DB, entry)),
        ...claimItemsForPostelStmts(env.DB, postelId, toAdd),
        writeAudit(env.DB, {
          ts: updatedAt,
          actor: actor.email,
          action: 'postel.create',
          target: postelTarget(postelId),
          before: null,
          after,
        }),
      ],
      postelId,
      toAdd,
    );
    return loadPostelDto(env, actor, postelId);
  }
  const before = postelSnapshot(existing, stored, owned.length, existing.attachments.length);
  await runPostelBatch(
    env,
    [
      updatePostelStmt(env.DB, next, existing.updatedAt),
      guardChanged(env.DB),
      // Hapus dulu agar nomor yang dibuang dapat dipakai ulang oleh baris lain pada simpanan yang sama.
      ...removedNumbers.map((entry) => deletePostelNumberStmt(env.DB, entry.id, postelId)),
      ...updatedNumbers.map((entry) => updatePostelNumberStmt(env.DB, entry)),
      ...insertedNumbers.map((entry) => insertPostelNumberStmt(env.DB, entry)),
      ...releaseItemsFromPostelStmt(env.DB, postelId, toRemove),
      ...claimItemsForPostelStmts(env.DB, postelId, toAdd),
      writeAudit(env.DB, {
        ts: updatedAt,
        actor: actor.email,
        action: 'postel.update',
        target: postelTarget(postelId),
        before,
        after,
      }),
    ],
    postelId,
    toAdd,
  );
  return loadPostelDto(env, actor, postelId);
}

/**
 * Menghapus catatan: melepas semua itemnya dan menghapus nomornya dalam satu batch. Stiker "Postel" dan stoknya tetap
 * (stiker tidak pernah dihapus). Pembuangan berkas lampiran menyusul bersama fitur lampiran.
 */
export async function removePostel(env: Env, id: string, actor: UserContext): Promise<null> {
  const record = await findPostelRecord(env.DB, id);
  if (!record) throw appError('NOT_FOUND', 'Postel tidak ditemukan');
  const [numbers, items] = await Promise.all([
    listPostelNumbers(env.DB, [id]),
    listItemsOfPostels(env.DB, [id]),
  ]);
  const before = postelSnapshot(
    record,
    numbers,
    (items.get(id) ?? []).length,
    record.attachments.length,
  );
  await runGuardedBatch(
    env.DB,
    [
      // Kunci baris dulu: penyimpan serentak menunggu lalu mendapati catatan sudah hilang (basi).
      lockPostelRowStmt(env.DB, id),
      releaseAllItemsFromPostelStmt(env.DB, id),
      deletePostelNumbersOfStmt(env.DB, id),
      deletePostelStmt(env.DB, id),
      // Catatan yang sudah dihapus pemanggil lain: tak ada baris terhapus = batal (tanpa audit ganda).
      guardChanged(env.DB),
      writeAudit(env.DB, {
        ts: nowIso(env),
        actor: actor.email,
        action: 'postel.delete',
        target: postelTarget(id),
        before,
        after: null,
      }),
    ],
    () => appError('NOT_FOUND', 'Postel tidak ditemukan'),
  );
  return null;
}
