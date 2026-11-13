import { listAuditByTarget, writeAudit } from '@server/core/audit';
import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, staleError as coreStaleError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
import { PAGE_DEFAULT_LIMIT, parseAuditCursor } from '@server/modules/access/validate';
import { findActiveFiles } from '@server/modules/files/repo';
import { visibleBuIds } from '@server/modules/item/access';
import { itemIdsVisibleIn } from '@server/modules/item/repo';
import { guardChanged, runGuardedBatch } from '@server/modules/qrcode/repo';
import { ensurePostelType } from '@server/modules/sticker/postel';
import type {
  AuditCursorPageDto,
  ListPostelHistoryInput,
  PostelAttachmentDto,
  PostelDto,
  PostelListDto,
  PostelNumberDto,
  PostelSummaryDto,
  SavePostelInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import {
  comparePostels,
  daysUntil,
  POSTEL_LIMITS,
  postelCondition,
  postelName,
  postelRoles,
  wibDateIso,
} from '@shared/postel';
import { readPostelAlert } from './alert';
import {
  loadAttachmentDtos,
  planPostelAttachments,
  purgeReleasedAttachments,
  releaseAttachmentStmts,
} from './attachments';
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
  linkPostelStickerStmt,
  listPostelNumbers,
  listPostelRecords,
  lockPostelRowStmt,
  type PostelNumberRecord,
  type PostelRecord,
  parkPostelNumberKeyStmt,
  updatePostelNumberContentStmt,
  updatePostelStmt,
} from './repo';
import {
  newPostelStickerStmt,
  pickPostelStickerName,
  postelStickerBase,
  renameStickerStmt,
  retirePostelSticker,
} from './stickers';

export { queryPostelItemOptions } from './items';

export const POSTEL_STALE_MESSAGE =
  'Postel sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

export { SETTING_POSTEL_ALERT } from './alert';

/** Bentrok indeks unik nomor sertifikat; pesan generik (tidak memuat catatan pemilik nomor itu). */
const POSTEL_CONFLICTS = {
  postel_numbers_key: { field: 'number', message: 'Nomor sertifikat sudah dipakai' },
  stickers_type_name_unique: {
    field: 'itemIds',
    message: 'Nama stiker Postel bentrok dengan catatan lain; simpan ulang',
  },
};

function staleError(): Error {
  return coreStaleError(POSTEL_STALE_MESSAGE);
}

function fieldFail(field: string, message: string, code: 'VALIDATION' | 'CONFLICT' = 'VALIDATION') {
  return appError(code, message, { [field]: message });
}

/**
 * Ambang "segera habis" = ambang peringatan terbesar di `POSTEL_ALERT`. Pembacaan LONGGAR lewat `readPostelAlert`:
 * pengaturan belum ada, bukan JSON, atau tanpa ambang sah memakai `POSTEL_ALERT_DEFAULTS` (tampilan tak boleh gagal
 * karena pengaturan rusak).
 */
export async function postelSoonDays(env: Env): Promise<number> {
  const { alert } = await readPostelAlert(env);
  return Math.max(...alert.thresholds);
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
  withVisible = true,
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
  // Ringkasan daftar tidak memakai item terlihat: lewati kueri visibilitas.
  const visible = withVisible
    ? await itemIdsVisibleIn(
        env.DB,
        [...items.values()].flatMap((list) => list.map((item) => item.id)),
        visibleBuIds(user),
      )
    : new Set<string>();
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

function toPostelDto(
  record: PostelRecord,
  read: PostelRead,
  attachments: PostelAttachmentDto[],
): PostelDto {
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
    attachments,
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
    numbers: numbers.map((entry) => entry.number),
    models: distinctModels(read.items.get(record.id) ?? []),
    updatedAt: record.updatedAt,
  };
}

/** Model item yang berbeda (tanpa beda huruf besar), tanpa merk, urut seperti nama turunan. */
function distinctModels(items: readonly PostelItem[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of items) {
    const model = item.model.trim();
    const key = normalizeKey(model);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    models.push(model);
  }
  return models.sort((a, b) => a.localeCompare(b));
}

/** Semua catatan (maks. 500), urut tanggal habis nomor Aktif menaik; penyaringan dan pencarian di klien. */
export async function listPostels(env: Env, user: UserContext): Promise<PostelListDto> {
  const records = await listPostelRecords(env.DB);
  const read = await readPostels(env, user, records, undefined, false);
  const summaries = records
    .map((record) => toSummaryDto(record, read))
    .sort(comparePostels)
    .slice(0, POSTEL_LIMITS.listMax);
  return { postels: summaries, today: read.today, soonDays: read.soonDays };
}

async function loadPostelDto(env: Env, user: UserContext, id: string): Promise<PostelDto> {
  const record = await findPostelRecord(env.DB, id);
  if (!record) throw appError('NOT_FOUND', 'Postel tidak ditemukan');
  const [read, attachments] = await Promise.all([
    readPostels(env, user, [record], [id]),
    loadAttachmentDtos(env, record.attachments),
  ]);
  return toPostelDto(record, read, attachments);
}

/**
 * Riwayat perubahan satu catatan: entri log audit bertarget `postel:<id>`, terbaru dahulu. Catatan yang tak ada (atau
 * sudah dihapus) = `NOT_FOUND`; riwayat catatan terhapus tetap di log audit umum. Snapshot hanya memuat isi bisnis
 * (jumlah item dan lampiran, bukan identitasnya), jadi aman bagi setiap pemegang `sticker: view`.
 */
export async function postelHistory(
  env: Env,
  id: string,
  input: ListPostelHistoryInput,
): Promise<AuditCursorPageDto> {
  if ((await findPostelRecord(env.DB, id)) === null) {
    throw appError('NOT_FOUND', 'Postel tidak ditemukan');
  }
  const cursor = input.cursor ? parseAuditCursor(input.cursor) : null;
  return listAuditByTarget(env, postelTarget(id), {
    ...(cursor ? { cursor } : {}),
    limit: input.limit ?? PAGE_DEFAULT_LIMIT,
  });
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
 * Menulis catatan beserta nomor dan pemasangan item dalam SATU transaksi. Penjaga yang gagal membatalkan seluruhnya.
 * Penyebabnya dipilah berurutan: (1) versi catatan sudah berubah (atau catatan hilang) = `staleError`; (2) versi masih
 * sama dan ada item yang kini dimiliki catatan lain = `CONFLICT` pada `itemIds` dengan nomor Aktif pemilik; (3) selain
 * itu (item dinonaktifkan atau dihapus di sela pemeriksaan dan batch) = `VALIDATION` generik "Item tidak ditemukan";
 * (4) lampiran yang direbut simpanan lain atau hilang di sela pemeriksaan dan batch = `VALIDATION` pada `attachmentIds`.
 * Nomor kembar (indeks unik) menjadi `CONFLICT` pada `number`. `expectedUpdatedAt` kosong = catatan baru.
 */
export async function runPostelBatch(
  env: Env,
  statements: DbStatement[],
  postelId: string,
  claimedIds: readonly string[],
  expectedUpdatedAt = '',
  claimedFileIds: readonly string[] = [],
): Promise<void> {
  try {
    await runGuardedBatch(env.DB, statements, staleError);
  } catch (error) {
    const mapped = mapDuplicateError(error, POSTEL_CONFLICTS);
    // Bentrok nama stiker bisa hanya akibat sampingan kalah berebut item (dua catatan memasang item sama menurunkan nama
    // yang sama): sebab sebenarnya dipilah di bawah lebih dulu, bentrok nama dilaporkan bila bukan itu sebabnya.
    const nameClash = error instanceof DbError && error.key === 'stickers_type_name_unique';
    if (mapped !== error && !nameClash) throw mapped;
    if (!nameClash && (error as { stale?: boolean }).stale !== true) throw error;
    if (!nameClash && expectedUpdatedAt !== '') {
      const current = await findPostelRecord(env.DB, postelId);
      if (!current || current.updatedAt !== expectedUpdatedAt) throw error;
    }
    if (claimedIds.length > 0) {
      const now = await findPostelItemsById(env.DB, claimedIds);
      const taken = claimedIds
        .map((id) => now.get(id))
        .find((item) => item !== undefined && item.postelId !== '' && item.postelId !== postelId);
      if (taken) {
        const message = itemTakenMessage(taken, await activeNumberOf(env, taken.postelId));
        throw appError('CONFLICT', message, { itemIds: message });
      }
      if (claimedIds.some((id) => (now.get(id)?.status ?? 'inactive') !== 'active')) {
        throw fieldFail('itemIds', 'Item tidak ditemukan');
      }
    }
    if (claimedFileIds.length > 0) {
      const files = new Map(
        (await findActiveFiles(env, claimedFileIds)).map((file) => [file.id, file] as const),
      );
      const lost = claimedFileIds.some((id) => {
        const file = files.get(id);
        return (
          !file ||
          (file.ownerType !== '' && !(file.ownerType === 'postel' && file.ownerId === postelId))
        );
      });
      if (lost) {
        const message = 'Ada lampiran yang tidak dikenal';
        throw fieldFail('attachmentIds', message);
      }
    }
    throw nameClash ? mapped : error;
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

  // Lampiran: berkas harus unggahan sendiri atau sudah milik catatan ini; selain itu dijawab sama (tak dikenal).
  const existingAttachments = existing?.attachments ?? [];
  const attach = await planPostelAttachments(
    env,
    postelId,
    input.attachmentIds,
    existingAttachments,
    actor,
  );
  const attachmentsChanged =
    JSON.stringify(input.attachmentIds) !== JSON.stringify(existingAttachments);

  const numbersChanged =
    insertedNumbers.length > 0 || updatedNumbers.length > 0 || removedNumbers.length > 0;
  if (
    existing &&
    existing.note === input.note &&
    !numbersChanged &&
    toAdd.length === 0 &&
    toRemove.length === 0 &&
    !attachmentsChanged
  ) {
    // Tanpa perubahan: tidak ada tulisan, audit, atau kenaikan `updatedAt` (versi yang dimuat orang lain tetap sah).
    return loadPostelDto(env, actor, existing.id);
  }

  // Stiker katalog catatan ini (satu per catatan): jenis Postel lahir malas (idempoten, aman serentak); stiker baru
  // dibuat di batch yang sama dengan catatannya (catatan baru, atau catatan lama yang belum bersiker), dan namanya
  // disamakan dengan nama turunan bila berubah (item ditambah/dikurangi; keputusan pemilik 2026-11-12).
  const type = await ensurePostelType(env, actor);
  const finalItems: PostelItem[] = [
    ...requested.flatMap((id) => {
      const item = fetched.get(id);
      return item ? [item] : [];
    }),
    ...hiddenOwned,
  ];
  const activeNumber = [...finalNumbers].sort((a, b) => b.seq - a.seq)[0]?.number ?? '';
  const stickerBase = postelStickerBase(finalItems);
  const stickerNow = nowIso(env);
  let stickerId = existing?.stickerId ?? '';
  const stickerStatements: DbStatement[] = [];
  const stickerName = await pickPostelStickerName(
    env.DB,
    type.id,
    stickerBase,
    activeNumber,
    stickerId,
  );
  if (stickerId === '') {
    const created = newPostelStickerStmt(env.DB, type, stickerName, actor.email, stickerNow);
    stickerId = created.stickerId;
    stickerStatements.push(created.statement);
  } else {
    stickerStatements.push(
      renameStickerStmt(env.DB, stickerId, stickerName, actor.email, stickerNow),
    );
  }

  const next: PostelRecord = {
    id: postelId,
    note: input.note,
    attachments: input.attachmentIds,
    stickerId,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    updatedBy: actor.email,
  };
  const after = postelSnapshot(next, finalNumbers, finalItemCount, next.attachments.length);
  if (!existing) {
    await runPostelBatch(
      env,
      [
        ...stickerStatements,
        insertPostelStmt(env.DB, next),
        ...insertedNumbers.map((entry) => insertPostelNumberStmt(env.DB, entry)),
        ...claimItemsForPostelStmts(env.DB, postelId, toAdd),
        ...attach.statements,
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
      '',
      attach.claimedIds,
    );
    return loadPostelDto(env, actor, postelId);
  }
  const before = postelSnapshot(existing, stored, owned.length, existing.attachments.length);
  // Hanya urutan lampiran yang berubah (himpunan sama, tak ada perubahan lain): snapshot audit tak memuat urutan, jadi
  // entri `postel.update` akan berisi before == after (perubahan semu). Perubahan tetap disimpan, tanpa entri audit.
  const reorderOnly =
    existing.note === input.note &&
    !numbersChanged &&
    toAdd.length === 0 &&
    toRemove.length === 0 &&
    attachmentsChanged &&
    JSON.stringify([...input.attachmentIds].sort()) ===
      JSON.stringify([...existingAttachments].sort());
  await runPostelBatch(
    env,
    [
      updatePostelStmt(env.DB, next, existing.updatedAt),
      guardChanged(env.DB),
      ...stickerStatements,
      ...(existing.stickerId === '' ? [linkPostelStickerStmt(env.DB, postelId, stickerId)] : []),
      // Hapus dulu agar nomor yang dibuang dapat dipakai ulang oleh baris lain pada simpanan yang sama.
      ...removedNumbers.map((entry) => deletePostelNumberStmt(env.DB, entry.id, postelId)),
      // Rantai/tukar nomor: kunci yang berubah diparkir dulu (placeholder unik), baru nilai sebenarnya ditulis.
      ...updatedNumbers
        .filter((entry) => storedById.get(entry.id)?.numberKey !== entry.numberKey)
        .map((entry) => parkPostelNumberKeyStmt(env.DB, entry.id, postelId)),
      ...updatedNumbers.map((entry) =>
        updatePostelNumberContentStmt(
          env.DB,
          entry,
          storedById.get(entry.id)?.expiresOn !== entry.expiresOn,
        ),
      ),
      ...insertedNumbers.map((entry) => insertPostelNumberStmt(env.DB, entry)),
      ...releaseItemsFromPostelStmt(env.DB, postelId, toRemove),
      ...claimItemsForPostelStmts(env.DB, postelId, toAdd),
      ...attach.statements,
      ...(reorderOnly
        ? []
        : [
            writeAudit(env.DB, {
              ts: updatedAt,
              actor: actor.email,
              action: 'postel.update',
              target: postelTarget(postelId),
              before,
              after,
            }),
          ]),
    ],
    postelId,
    toAdd,
    existing.updatedAt,
    attach.claimedIds,
  );
  // Lampiran yang dilepas dibuang dari Drive SETELAH komit (bukan di dalam batch/transaksi yang dapat diulang).
  await purgeReleasedAttachments(env, attach.released);
  return loadPostelDto(env, actor, postelId);
}

/**
 * Menghapus catatan: melepas semua itemnya dan menghapus nomornya dalam satu batch. Stiker catatan itu menjadi nonaktif
 * (stok 0) atau usang (masih berstok) dan stoknya tetap terbaca (stiker tidak pernah dihapus). Lampirannya ditandai
 * `pending_delete` di transaksi yang sama (langsung tak terbaca) dan berkas Drive-nya dibuang SETELAH komit.
 */
export async function removePostel(env: Env, id: string, actor: UserContext): Promise<null> {
  // Satu transaksi dengan kunci baris catatan (`FOR UPDATE`) lebih dulu: snapshot audit dibaca SESUDAH kunci, jadi memuat
  // simpanan serentak yang lebih dulu selesai; penyimpan yang menyusul menunggu lalu mendapati catatan sudah hilang.
  const released = await env.DB.transaction(async (tx) => {
    if ((await lockPostelRowStmt(tx, id).first()) === null) {
      throw appError('NOT_FOUND', 'Postel tidak ditemukan');
    }
    const record = await findPostelRecord(tx, id);
    if (!record) throw appError('NOT_FOUND', 'Postel tidak ditemukan');
    const numbers = await listPostelNumbers(tx, [id]);
    const items = await listItemsOfPostels(tx, [id]);
    const before = postelSnapshot(
      record,
      numbers,
      (items.get(id) ?? []).length,
      record.attachments.length,
    );
    await retirePostelSticker(tx, record.stickerId, actor.email, nowIso(env));
    await releaseAllItemsFromPostelStmt(tx, id).run();
    for (const statement of releaseAttachmentStmts(tx, id, record.attachments))
      await statement.run();
    await deletePostelNumbersOfStmt(tx, id).run();
    await deletePostelStmt(tx, id).run();
    await writeAudit(tx, {
      ts: nowIso(env),
      actor: actor.email,
      action: 'postel.delete',
      target: postelTarget(id),
      before,
      after: null,
    }).run();
    return record.attachments;
  });
  await purgeReleasedAttachments(env, released);
  return null;
}
