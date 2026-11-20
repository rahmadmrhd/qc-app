import { writeAudit } from '@server/core/audit';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import { base64ToBytes, bytesToBase64, shortDigest } from '@server/core/bytes';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, staleError as coreStaleError } from '@server/core/errors';
import { cachedFileContent, dropCachedFile } from '@server/core/file-cache';
import { folderIdOf } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import { listBusinessUnitBriefs, mapDuplicateError } from '@server/modules/access/repo';
import { planAttachFiles } from '@server/modules/files/service';
import { listQrVersions } from '@server/modules/sticker/manual-book';
import type {
  ClonePresetInput,
  CloneQrPdfInput,
  ListQrItemOptionsInput,
  QrDefaultsDto,
  QrDesignDto,
  QrDesignItemDto,
  QrDesignRefInput,
  QrDocumentDto,
  QrFileDto,
  QrFileInput,
  QrItemOptionsPageDto,
  QrLogoLibraryDto,
  QrPresetDto,
  QrVersionDto,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/contract';
import { base64ByteLength } from '@shared/files';
import type { QrContent } from '@shared/qrcode';
import {
  clampQrLayout,
  clampQrStyle,
  DEFAULT_QR_STYLE,
  driveShareUrl,
  labelFileName,
  manualBookFileName,
  parseDriveFileId,
  parseDriveResourceKey,
  QR_LIMITS,
  qrExportStatus,
  qrPdfFileName,
} from '@shared/qrcode';
import type { StickerStatus } from '@shared/stickers';
import { manualBookStickerName } from '@shared/stickers';
import { ensureQrDocFolder, QR_FOLDER_SETTING } from './folders';
import {
  claimItemsStmts,
  designHasVersions,
  designNamesOf,
  findItemsById,
  latestVersionsByDesign,
  listAttachedItems,
  listLinkedItems,
  noVersionsGuardStmt,
  queryItemOptions,
  releaseAllItemsStmt,
  releaseItemsStmt,
  visibleItemIds,
} from './items';
import type {
  NewQrDesignRecord,
  NewQrPresetRecord,
  QrDesignRecord,
  QrDocumentRecord,
  QrPresetRecord,
} from './repo';
import {
  deleteQrDesignStmt,
  deleteQrPresetStmt,
  getQrDefaultsRecord,
  guardChanged,
  insertQrDefaultsStmt,
  insertQrDesignStmt,
  insertQrDocumentStmt,
  insertQrPresetStmt,
  listQrDesigns,
  listQrDocuments,
  listQrPresets,
  lockQrDesignRowStmt,
  runGuardedBatch,
  setQrDesignOverflowStmt,
  updateQrDefaultsStmt,
  updateQrDesignContentStmt,
  updateQrDocumentStmt,
  updateQrPresetStmt,
} from './repo';

export const QR_STALE_MESSAGE =
  'Konfigurasi sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

function staleError(): Error {
  return coreStaleError(QR_STALE_MESSAGE);
}

/** Link efektif: URL yang diketik, atau URL berbagi PDF sumber (kosong bila dokumen hilang). */
export function qrEffectiveLink(
  design: Pick<NewQrDesignRecord, 'linkSource' | 'link' | 'documentId'>,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): string {
  if (design.linkSource === 'url') return design.link;
  const doc = documents.get(design.documentId);
  return doc ? driveShareUrl(doc.driveId) : '';
}

export function qrDesignContent(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): QrContent {
  return {
    linkSource: design.linkSource,
    link: qrEffectiveLink(design, documents),
    title: design.title,
    subtitle: design.subtitle,
    footer: design.footer,
    logoFileId: design.logoFileId,
    layout: design.layout,
    style: design.style,
  };
}

export async function qrDocumentMap(env: Env): Promise<Map<string, QrDocumentRecord>> {
  return new Map((await listQrDocuments(env)).map((doc) => [doc.id, doc]));
}

/** Bagian DTO yang bergantung pada pembaca (item terlihat menurut BU) dan versi stiker. */
export interface QrDesignView {
  items: QrDesignItemDto[];
  hiddenItemCount: number;
  stickerVersion: number;
  stickerStatus: StickerStatus | '';
}

const EMPTY_VIEW: QrDesignView = {
  items: [],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
};

/** Tampilan per konfigurasi bagi `user`: item terlihat, jumlah tersembunyi, dan versi stiker terbaru. */
async function designViews(env: Env, user: UserContext): Promise<Map<string, QrDesignView>> {
  const [attached, latest] = await Promise.all([
    listLinkedItems(env.DB),
    latestVersionsByDesign(env.DB),
  ]);
  const visible = await visibleItemIds(
    env.DB,
    user,
    [...attached.values()].flatMap((list) => list.map((item) => item.id)),
  );
  const views = new Map<string, QrDesignView>();
  for (const designId of new Set([...attached.keys(), ...latest.keys()])) {
    const all = attached.get(designId) ?? [];
    const shown = all.filter((item) => visible.has(item.id));
    const version = latest.get(designId);
    views.set(designId, {
      // Item terhapus tetap tampil (penampil rujukan) dengan penanda; hitungan hanya item hidup.
      items: shown.map((item) => ({
        id: item.id,
        brand: item.brand,
        model: item.model,
        ...(item.deleted ? { deleted: true } : {}),
      })),
      hiddenItemCount: all.filter((item) => !item.deleted && !visible.has(item.id)).length,
      stickerVersion: version?.version ?? 0,
      stickerStatus: version?.status ?? '',
    });
  }
  return views;
}

export function toQrDesignDto(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
  view: QrDesignView = EMPTY_VIEW,
): QrDesignDto {
  const content = qrDesignContent(design, documents);
  return {
    id: design.id,
    name: design.name,
    namePlacement: design.namePlacement,
    presetId: design.presetId,
    items: view.items,
    hiddenItemCount: view.hiddenItemCount,
    stickerVersion: view.stickerVersion,
    stickerStatus: view.stickerStatus,
    title: design.title,
    linkSource: design.linkSource,
    link: content.link,
    documentId: design.documentId,
    documentName: documents.get(design.documentId)?.name ?? '',
    subtitle: design.subtitle,
    footer: design.footer,
    logoFileId: design.logoFileId,
    layout: design.layout,
    style: design.style,
    overflow: design.overflow,
    exportStatus: qrExportStatus(design.exportedHash, content),
    exportedAt: design.exportedAt,
    exportedBy: design.exportedBy,
    createdAt: design.createdAt,
    createdBy: design.createdBy,
    updatedAt: design.updatedAt,
    updatedBy: design.updatedBy,
  };
}

export function qrDesignSnapshot(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
  itemIds: readonly string[],
): Record<string, unknown> {
  return {
    name: design.name,
    presetId: design.presetId,
    items: [...itemIds].sort().join(','),
    title: design.title,
    linkSource: design.linkSource,
    link: qrEffectiveLink(design, documents),
    subtitle: design.subtitle,
    footer: design.footer,
    logo: design.logoFileId === '' ? 'tanpa' : design.logoFileId,
    layout: JSON.stringify(design.layout),
    frame: design.style.frame.kind,
    style: JSON.stringify(design.style),
  };
}

export async function listQrDesignDtos(env: Env, user: UserContext): Promise<QrDesignDto[]> {
  const [designs, documents, views] = await Promise.all([
    listQrDesigns(env),
    qrDocumentMap(env),
    designViews(env, user),
  ]);
  return designs
    .map((design) => toQrDesignDto(design, documents, views.get(design.id)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export async function getQrDesignDto(
  env: Env,
  input: QrDesignRefInput,
  user: UserContext,
): Promise<QrDesignDto> {
  const designs = await listQrDesigns(env);
  const design = designs.find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  const [documents, views] = await Promise.all([qrDocumentMap(env), designViews(env, user)]);
  return toQrDesignDto(design, documents, views.get(design.id));
}

/** Riwayat versi Manual Book sebuah konfigurasi QR (terbaru dahulu); id tak dikenal = NOT_FOUND. */
export async function qrVersions(env: Env, input: QrDesignRefInput): Promise<QrVersionDto[]> {
  const design = (await listQrDesigns(env)).find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  return listQrVersions(env, design.id);
}

/** Opsi item bagi pemilih di form QR (item aktif yang terlihat bagi pengguna menurut BU). */
export function qrItemOptions(
  env: Env,
  input: ListQrItemOptionsInput,
  user: UserContext,
): Promise<QrItemOptionsPageDto> {
  return queryItemOptions(env, user, input);
}

function toQrPresetDto(record: QrPresetRecord): QrPresetDto {
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    subtitle: record.subtitle,
    footer: record.footer,
    layout: record.layout,
    style: record.style,
    defaultLogoId: record.defaultLogoId,
    buId: record.buId,
    namePlacement: record.namePlacement,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

/** Semua konfigurasi default (urut nama) dan pustaka logo bersama. */
export async function getQrDefaultsDto(env: Env): Promise<QrDefaultsDto> {
  const [library, presets] = await Promise.all([getQrDefaultsRecord(env), listQrPresets(env)]);
  return {
    presets: presets.map(toQrPresetDto).sort((a, b) => a.name.localeCompare(b.name)),
    logoFileIds: library?.logoFileIds ?? [],
    logoUpdatedAt: library?.updatedAt ?? '',
  };
}

function qrPresetSnapshot(preset: QrPresetRecord | NewQrPresetRecord): Record<string, string> {
  return {
    name: preset.name,
    title: preset.title,
    subtitle: preset.subtitle,
    footer: preset.footer,
    layout: JSON.stringify(preset.layout),
    style: JSON.stringify(preset.style),
    defaultLogoId: preset.defaultLogoId,
    buId: preset.buId,
    namePlacement: preset.namePlacement,
  };
}

const PRESET_CONFLICTS = {
  qr_presets_bu_unique: {
    field: 'buId',
    message: 'BU ini sudah punya konfigurasi default',
  },
};

export const MANUAL_BOOK_NAME_TAKEN_MESSAGE = 'Nama Manual Book sudah dipakai konfigurasi lain';

/**
 * Nama Manual Book tak boleh sama (tanpa beda huruf besar, sama dengan kunci nama stiker `<nama> vN`) dengan
 * konfigurasi LAIN (`exceptId`; '' = tak ada yang dikecualikan). Pesan generik: tidak menyebut konfigurasi atau BU
 * pemilik nama (tak membocorkan data di luar hak penyimpan). Pelindung terakhir ada di komit ekspor
 * (`stickers_type_name_unique`); balapan dua simpanan serentak yang lolos bersamaan terkunci di ekspor.
 */
export async function assertManualBookNameFree(
  env: Env,
  name: string,
  exceptId: string,
): Promise<void> {
  const taken = await env.DB.prepare(
    "SELECT 1 AS taken FROM qr_designs WHERE id <> ? AND name <> '' AND LOWER(name) = LOWER(?) LIMIT 1",
  )
    .bind(exceptId, name)
    .first<{ taken: number }>();
  if (taken) {
    throw appError('VALIDATION', MANUAL_BOOK_NAME_TAKEN_MESSAGE, {
      name: MANUAL_BOOK_NAME_TAKEN_MESSAGE,
    });
  }
}

/**
 * Nama stiker yang AKAN lahir (`<nama> v<versi>`, dipotong ke batas nama stiker seperti di komit ekspor) tak boleh
 * sama (tanpa beda huruf besar, setara `name_key`) dengan stiker jenis sistem Manual Book mana pun yang bukan milik
 * konfigurasi ini (`designId`; milik sendiri = punya baris `manual_book_versions` dengan `design_id` itu). Menutup
 * "nama stiker historis": nama lama konfigurasi lain yang pernah diekspor tetap tinggal di katalog. Pesan generik.
 * `version` kosong = versi berikutnya menurut basis data (jalur simpan).
 */
export async function assertManualBookStickerNameFree(
  env: Env,
  name: string,
  designId: string,
  version?: number,
): Promise<void> {
  const next =
    version ??
    Number(
      (
        await env.DB.prepare(
          'SELECT COALESCE(MAX(version), 0) AS v FROM manual_book_versions WHERE design_id = ?',
        )
          .bind(designId)
          .first<{ v: number | string }>()
      )?.v,
    ) + 1;
  const stickerName = manualBookStickerName(name, next);
  const taken = await env.DB.prepare(
    "SELECT 1 AS taken FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE t.system_kind = 'manual_book' AND s.deleted_at = '' AND t.deleted_at = '' AND LOWER(s.name) = LOWER(?) AND s.id NOT IN (SELECT sticker_id FROM manual_book_versions WHERE design_id = ?) LIMIT 1",
  )
    .bind(stickerName, designId)
    .first<{ taken: number }>();
  if (taken) {
    throw appError('VALIDATION', MANUAL_BOOK_NAME_TAKEN_MESSAGE, {
      name: MANUAL_BOOK_NAME_TAKEN_MESSAGE,
    });
  }
}

/** BU harus ada dan aktif; satu BU paling banyak satu preset (selain `exceptId`). */
async function assertPresetBu(
  env: Env,
  buId: string,
  presets: readonly QrPresetRecord[],
  exceptId: string | undefined,
): Promise<void> {
  const fail = (message: string, code: 'VALIDATION' | 'CONFLICT' = 'VALIDATION'): never => {
    throw appError(code, message, { buId: message });
  };
  const bu = (await listBusinessUnitBriefs(env)).find((row) => row.id === buId);
  if (!bu) return fail('BU tidak ditemukan');
  if (bu.status !== 'active') return fail('BU nonaktif tidak dapat dipakai');
  if (presets.some((row) => row.id !== exceptId && row.buId === buId)) {
    return fail('BU ini sudah punya konfigurasi default', 'CONFLICT');
  }
}

function assertPresetNameFree(
  presets: readonly QrPresetRecord[],
  name: string,
  exceptId: string | undefined,
): void {
  if (presets.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase())) {
    const message = 'Nama sudah dipakai konfigurasi default lain';
    throw appError('VALIDATION', message, { name: message });
  }
}

/** Membuat atau mengubah satu konfigurasi default (nilai awal QR baru). Hanya pengaturan: tanpa hasil ekspor. */
export async function saveQrPreset(
  env: Env,
  input: SaveQrPresetInput,
  actor: ActorRef,
): Promise<QrPresetDto> {
  const presets = await listQrPresets(env);
  const existing = input.id ? presets.find((row) => row.id === input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Konfigurasi default tidak ditemukan');
  if (existing && input.expectedUpdatedAt !== existing.updatedAt) throw staleError();
  assertPresetNameFree(presets, input.name, existing?.id);
  if (!existing && presets.length >= QR_LIMITS.presets) {
    throw appError('VALIDATION', `Konfigurasi default maksimal ${QR_LIMITS.presets}`);
  }
  // BU yang tak berubah tidak diperiksa ulang: preset yang BU-nya kemudian nonaktif tetap dapat diubah/diganti
  // namanya (keputusan pemilik 2026-11-11); BU baru (preset baru atau pindah BU) wajib ada, aktif, dan belum punya preset.
  if (!existing || existing.buId !== input.buId) {
    await assertPresetBu(env, input.buId, presets, existing?.id);
  }
  const library = (await getQrDefaultsRecord(env))?.logoFileIds ?? [];
  if (input.defaultLogoId !== '' && !library.includes(input.defaultLogoId)) {
    const message = 'Logo awal harus bagian dari pustaka logo';
    throw appError('VALIDATION', message, { defaultLogoId: message });
  }
  const now = nowIso(env);
  const next: NewQrPresetRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name,
    title: input.title,
    subtitle: input.subtitle,
    footer: input.footer,
    layout: input.layout,
    style: input.style,
    defaultLogoId: input.defaultLogoId,
    buId: input.buId,
    namePlacement: input.namePlacement,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.email,
    updatedAt: now,
    updatedBy: actor.email,
  };
  if (!existing) {
    try {
      await env.DB.batch([
        insertQrPresetStmt(env.DB, next),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'qrcode.preset_create',
          target: next.name,
          before: null,
          after: qrPresetSnapshot(next),
        }),
      ]);
    } catch (error) {
      throw mapDuplicateError(error, PRESET_CONFLICTS);
    }
    return toQrPresetDto(next);
  }
  if (JSON.stringify(qrPresetSnapshot(existing)) === JSON.stringify(qrPresetSnapshot(next))) {
    return toQrPresetDto(existing);
  }
  try {
    await runGuardedBatch(
      env.DB,
      [
        updateQrPresetStmt(env.DB, next, existing.updatedAt),
        guardChanged(env.DB),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'qrcode.preset_update',
          target: next.name,
          before: qrPresetSnapshot(existing),
          after: qrPresetSnapshot(next),
        }),
      ],
      staleError,
    );
  } catch (error) {
    throw mapDuplicateError(error, PRESET_CONFLICTS);
  }
  return toQrPresetDto(next);
}

/**
 * Menyalin satu preset ke BU lain (spek 4a §3 butir 24): seluruh isi (gaya, tata letak, logo awal, penempatan nama)
 * dibawa, hanya BU dan nama yang diganti. BU tujuan harus aktif dan belum punya preset.
 */
export async function cloneQrPreset(
  env: Env,
  input: ClonePresetInput,
  actor: ActorRef,
): Promise<QrPresetDto> {
  const presets = await listQrPresets(env);
  const source = presets.find((row) => row.id === input.id);
  if (!source) throw appError('NOT_FOUND', 'Konfigurasi default tidak ditemukan');
  if (presets.length >= QR_LIMITS.presets) {
    throw appError('VALIDATION', `Konfigurasi default maksimal ${QR_LIMITS.presets}`);
  }
  assertPresetNameFree(presets, input.name, undefined);
  await assertPresetBu(env, input.buId, presets, undefined);
  const now = nowIso(env);
  const next: NewQrPresetRecord = {
    ...source,
    id: crypto.randomUUID(),
    name: input.name,
    buId: input.buId,
    createdAt: now,
    createdBy: actor.email,
    updatedAt: now,
    updatedBy: actor.email,
  };
  try {
    await env.DB.batch([
      insertQrPresetStmt(env.DB, next),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.preset_clone',
        target: next.name,
        before: { source: source.name },
        after: qrPresetSnapshot(next),
      }),
    ]);
  } catch (error) {
    throw mapDuplicateError(error, PRESET_CONFLICTS);
  }
  return toQrPresetDto(next);
}

export async function deleteQrPreset(
  env: Env,
  input: QrDesignRefInput,
  actor: ActorRef,
): Promise<QrDesignRefInput> {
  const existing = (await listQrPresets(env)).find((row) => row.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Konfigurasi default tidak ditemukan');
  await env.DB.batch([
    deleteQrPresetStmt(env.DB, existing.id),
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: actor.email,
      action: 'qrcode.preset_delete',
      target: existing.name,
      before: qrPresetSnapshot(existing),
      after: null,
    }),
  ]);
  return { id: existing.id };
}

/** Menyimpan pustaka logo bersama; logo yang dikeluarkan juga dikosongkan dari logo awal default yang memakainya. */
export async function saveQrLogoLibrary(
  env: Env,
  input: SaveQrLogoLibraryInput,
  actor: ActorRef,
): Promise<QrLogoLibraryDto> {
  const existing = await getQrDefaultsRecord(env);
  if (existing) {
    if (!input.expectedUpdatedAt) {
      const message = 'Wajib diisi saat mengubah';
      throw appError('VALIDATION', message, { expectedUpdatedAt: message });
    }
    if (input.expectedUpdatedAt !== existing.updatedAt) throw staleError();
  }
  // Logo pustaka: pemilik tetap ('qrlogo','shared') sehingga dapat dibaca/dirujuk semua pengguna qrcode.
  const attach = await planAttachFiles(
    env,
    input.logoFileIds,
    'qrlogo',
    'shared',
    undefined,
    actor.email,
  );
  const now = nowIso(env);
  const before = existing?.logoFileIds ?? [];
  if (existing && before.join(',') === input.logoFileIds.join(',')) {
    return { logoFileIds: before, logoUpdatedAt: existing.updatedAt };
  }
  const audit = writeAudit(env.DB, {
    ts: now,
    actor: actor.email,
    action: 'qrcode.logo_library_update',
    target: 'Pustaka logo QR',
    before: { logoFileIds: before.join(',') },
    after: { logoFileIds: input.logoFileIds.join(',') },
  });
  const presetCleanup = (await listQrPresets(env))
    .filter(
      (preset) => preset.defaultLogoId !== '' && !input.logoFileIds.includes(preset.defaultLogoId),
    )
    .map((preset) =>
      updateQrPresetStmt(env.DB, {
        ...preset,
        defaultLogoId: '',
        updatedAt: now,
        updatedBy: actor.email,
      }),
    );
  if (existing) {
    await runGuardedBatch(
      env.DB,
      [
        updateQrDefaultsStmt(
          env.DB,
          { ...existing, logoFileIds: input.logoFileIds, updatedAt: now, updatedBy: actor.email },
          existing.updatedAt,
        ),
        guardChanged(env.DB),
        ...attach,
        ...presetCleanup,
        audit,
      ],
      staleError,
    );
  } else {
    await env.DB.batch([
      insertQrDefaultsStmt(env.DB, {
        title: '',
        subtitle: '',
        footer: '',
        layout: clampQrLayout({}),
        style: clampQrStyle(null),
        logoFileIds: input.logoFileIds,
        defaultLogoId: '',
        updatedAt: now,
        updatedBy: actor.email,
      }),
      ...attach,
      ...presetCleanup,
      audit,
    ]);
  }
  return { logoFileIds: input.logoFileIds, logoUpdatedAt: now };
}

interface SaveOutcome {
  dto: QrDesignDto;
  /** Dokumen PDF yang baru saja dilepas oleh konfigurasi ini (kandidat pencabutan berbagi). */
  released: string[];
}

export async function saveQrDesign(
  env: Env,
  input: SaveQrDesignInput,
  actor: UserContext,
): Promise<QrDesignDto> {
  // Berbagi PDF (I/O Drive) sebelum menulis: PDF yang sebelumnya dicabut dibagikan lagi saat dipakai.
  const pdfId = input.linkSource === 'pdf' ? input.documentId : '';
  if (pdfId !== '') await ensureQrDocumentShared(env, pdfId);
  let outcome: SaveOutcome;
  try {
    outcome = await saveQrDesignNow(env, input, actor);
  } catch (error) {
    // Simpan ditolak (mis. CONFLICT dari form basi): PDF yang barusan dibagikan ulang tidak boleh tetap publik.
    if (pdfId !== '') await revokeUnusedQrDocuments(env, [pdfId]).catch(() => 0);
    throw error;
  }
  // Konfigurasi sudah tersimpan: langkah lanjutan (berbagi, nama berkas, pencabutan) best-effort — galatnya
  // hanya dicatat agar pengguna tidak melihat "gagal" untuk simpan yang sebenarnya berhasil.
  if (pdfId !== '') {
    await afterQrCommit('berbagi PDF', () => ensureQrDocumentShared(env, pdfId));
    await afterQrCommit('nama PDF', () =>
      renameQrDocument(env, pdfId, input.title, input.subtitle),
    );
  }
  await afterQrCommit('pencabutan berbagi', () => revokeUnusedQrDocuments(env, outcome.released));
  return outcome.dto;
}

async function afterQrCommit(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(
      `qrcode: ${label} gagal setelah simpan: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function saveQrDesignNow(
  env: Env,
  input: SaveQrDesignInput,
  actor: UserContext,
): Promise<SaveOutcome> {
  const designs = await listQrDesigns(env);
  const existing = input.id ? designs.find((row) => row.id === input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  if (existing && input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
    throw staleError();
  }
  // Link harus dari Drive (PDF sumber). Konfigurasi lama bersumber link manual boleh disimpan ulang selama
  // linknya tidak berubah.
  if (
    input.linkSource === 'url' &&
    !(existing && existing.linkSource === 'url' && existing.link === input.link)
  ) {
    const message = 'Link harus berasal dari Drive: unggah PDF atau salin berkas Drive ke aplikasi';
    throw appError('VALIDATION', message, { link: message });
  }
  if (
    existing &&
    existing.exportedHash !== '' &&
    existing.linkSource === 'pdf' &&
    input.linkSource === 'pdf' &&
    input.documentId !== existing.documentId
  ) {
    const message =
      'Konfigurasi sudah diekspor: PDF hanya dapat diganti isinya (URL tetap), bukan diganti dokumen lain';
    throw appError('VALIDATION', message, { documentId: message });
  }
  if (input.logoFileId !== '' && input.logoFileId !== (existing?.logoFileId ?? '')) {
    const library = (await getQrDefaultsRecord(env))?.logoFileIds ?? [];
    // Logo yang masih dipakai konfigurasi lain (mis. sumber duplikat berlogo lama) tetap boleh dirujuk.
    const inUse = designs.some((design) => design.logoFileId === input.logoFileId);
    if (!library.includes(input.logoFileId) && !inUse) {
      const message = 'Logo harus dipilih dari pustaka logo (diatur di Konfigurasi default)';
      throw appError('VALIDATION', message, { logoFileId: message });
    }
  }
  const documents = await qrDocumentMap(env);
  if (input.linkSource === 'pdf' && !documents.has(input.documentId)) {
    const message = 'PDF tidak dikenal; unggah ulang';
    throw appError('VALIDATION', message, { documentId: message });
  }
  // Satu PDF hanya untuk satu konfigurasi QR. Data lama yang sudah berbagi PDF tetap dapat disimpan selama
  // dokumennya tidak diubah.
  if (
    input.linkSource === 'pdf' &&
    input.documentId !== existing?.documentId &&
    designs.some(
      (row) =>
        row.id !== existing?.id && row.linkSource === 'pdf' && row.documentId === input.documentId,
    )
  ) {
    const message = 'PDF ini sudah dipakai konfigurasi QR lain; unggah atau salin PDF tersendiri';
    throw appError('VALIDATION', message, { documentId: message });
  }
  const fieldFail = (
    field: string,
    message: string,
    code: 'VALIDATION' | 'CONFLICT' = 'VALIDATION',
  ) => appError(code, message, { [field]: message });

  // Preset asal: dibutuhkan saat dibuat (penempatan nama disalin); saat mengubah hanya dicek bila berganti.
  let preset: QrPresetRecord | undefined;
  if (input.presetId !== '' && input.presetId !== existing?.presetId) {
    preset = (await listQrPresets(env)).find((row) => row.id === input.presetId);
    if (!preset) throw fieldFail('presetId', 'Konfigurasi default tidak ditemukan');
  }
  const namePlacement = existing ? existing.namePlacement : (preset?.namePlacement ?? '');

  // Item: hanya yang terlihat bagi penyimpan yang boleh dipilih/dilepas; yang tak terlihat tetap terpasang.
  const attached = await listLinkedItems(env.DB);
  const ownedNow = existing ? (attached.get(existing.id) ?? []) : [];
  const ownedIds = new Set(ownedNow.map((item) => item.id));
  const requested = input.itemIds;
  const fetched = await findItemsById(env.DB, requested);
  const visible = await visibleItemIds(env.DB, actor, [
    ...requested,
    ...ownedNow.map((item) => item.id),
  ]);
  const otherNames = await designNamesOf(
    env.DB,
    [...fetched.values()].map((item) => item.designId),
  );
  for (const id of requested) {
    const item = fetched.get(id);
    // Item tak ada dan item di luar BU penyimpan dijawab sama (keberadaan item BU lain tidak bocor).
    // Item terhapus hanya sah bila sudah terpasang di konfigurasi ini (rujukan tersimpan); tak boleh dipilih baru.
    if (!item || !visible.has(id) || (item.deleted && !ownedIds.has(id))) {
      throw fieldFail('itemIds', 'Item tidak ditemukan');
    }
    if (item.designId !== '' && item.designId !== existing?.id) {
      throw fieldFail('itemIds', itemTakenMessage(item, otherNames.get(item.designId)), 'CONFLICT');
    }
    if (!ownedIds.has(id) && item.status !== 'active') {
      throw fieldFail(
        'itemIds',
        `Item "${item.brand} ${item.model}" nonaktif dan tidak dapat dipilih`,
      );
    }
  }
  const hiddenOwned = ownedNow.filter((item) => !visible.has(item.id)).map((item) => item.id);
  const toAdd = requested.filter((id) => !ownedIds.has(id));
  const toRemove = ownedNow
    .filter((item) => visible.has(item.id) && !requested.includes(item.id))
    .map((item) => item.id);
  const finalIds = [...hiddenOwned, ...requested].sort();
  // Hitungan "minimal satu item" memakai item HIDUP saja (item terhapus tidak dihitung, soft delete §5).
  const deletedIds = new Set(
    [...ownedNow, ...fetched.values()].filter((item) => item.deleted).map((item) => item.id),
  );
  const liveFinalCount = finalIds.filter((id) => !deletedIds.has(id)).length;
  // Konfigurasi baru, yang sudah punya stiker, atau yang menampung nama di label wajib bernama dan beritem;
  // konfigurasi lama tanpa stiker boleh disimpan tanpa keduanya (baru menjadi Manual Book setelah dilengkapi).
  const hasVersions = existing ? await designHasVersions(env.DB, existing.id) : false;
  if (!existing || hasVersions || namePlacement !== '') {
    if (input.name === '') throw fieldFail('name', 'Nama Manual Book wajib diisi');
    if (liveFinalCount === 0) throw fieldFail('itemIds', 'Pilih minimal satu item');
  }
  // Nama Manual Book unik antar konfigurasi (tanpa beda huruf besar, seperti kunci nama stiker `<nama> vN`).
  if (input.name !== '') {
    await assertManualBookNameFree(env, input.name, existing?.id ?? '');
    await assertManualBookStickerNameFree(env, input.name, existing?.id ?? '');
  }
  // Kelonggaran dipakai: komit ekspor serentak (tidak menaikkan `updated_at`) dapat melahirkan versi sesudah
  // pembacaan di atas, jadi batch simpan menjaganya ulang (`noVersionsGuardStmt`, sesudah kunci baris dari UPDATE).
  const usesRelaxation = existing !== undefined && (input.name === '' || liveFinalCount === 0);

  const now = nowIso(env);
  const next: NewQrDesignRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    title: namePlacement === 'title' ? input.name : input.title,
    linkSource: input.linkSource,
    link: input.linkSource === 'url' ? input.link : '',
    documentId: input.linkSource === 'pdf' ? input.documentId : '',
    subtitle: namePlacement === 'subtitle' ? input.name : input.subtitle,
    footer: namePlacement === 'footer' ? input.name : input.footer,
    logoFileId: input.logoFileId,
    layout: input.layout,
    style: input.style ?? existing?.style ?? DEFAULT_QR_STYLE,
    overflow: input.overflow ?? existing?.overflow ?? false,
    exportedHash: existing?.exportedHash ?? '',
    exportedAt: existing?.exportedAt ?? '',
    exportedBy: existing?.exportedBy ?? '',
    exportPdfDriveId: existing?.exportPdfDriveId ?? '',
    exportPngDriveId: existing?.exportPngDriveId ?? '',
    // Penempatan nama hanya ditetapkan saat dibuat (disalin dari preset) dan tak berubah sesudahnya.
    name: input.name,
    namePlacement,
    presetId: input.presetId,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.email,
    updatedAt: now,
    updatedBy: actor.email,
  };
  // Logo bersama: pemilik tetap ('qrlogo','shared') agar banyak konfigurasi boleh merujuk berkas yang sama.
  const attach =
    next.logoFileId !== ''
      ? await planAttachFiles(env, [next.logoFileId], 'qrlogo', 'shared', undefined, actor.email)
      : [];
  const viewOf = async (record: NewQrDesignRecord): Promise<QrDesignDto> =>
    toQrDesignDto(record, documents, (await designViews(env, actor)).get(record.id));

  if (!existing) {
    await runItemBatch(
      env,
      [
        insertQrDesignStmt(env.DB, next),
        ...claimItemsStmts(env.DB, next.id, toAdd),
        ...attach,
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'qrcode.create',
          target: next.title,
          before: null,
          after: qrDesignSnapshot(next, documents, finalIds),
        }),
      ],
      next.id,
      toAdd,
    );
    return { dto: await viewOf(next), released: [] };
  }
  const before = qrDesignSnapshot(
    existing,
    documents,
    ownedNow.map((item) => item.id),
  );
  const after = qrDesignSnapshot(next, documents, finalIds);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    // Hanya flag "tidak muat" (laporan peramban) yang berubah: simpan diam-diam, tanpa audit dan tanpa
    // menaikkan updatedAt (agar versi yang sedang dimuat pengguna lain tidak jadi basi).
    if (existing.overflow !== next.overflow) {
      const flagged: QrDesignRecord = { ...existing, overflow: next.overflow };
      await env.DB.batch([setQrDesignOverflowStmt(env.DB, existing.id, next.overflow)]);
      return { dto: await viewOf(flagged), released: [] };
    }
    return { dto: await viewOf(existing), released: [] };
  }
  await runItemBatch(
    env,
    [
      // Tanpa kolom hasil ekspor: komit ekspor serentak tidak boleh ditimpa salinan basi.
      updateQrDesignContentStmt(env.DB, next, existing.updatedAt),
      guardChanged(env.DB),
      ...(usesRelaxation ? [noVersionsGuardStmt(env.DB, existing.id)] : []),
      ...releaseItemsStmt(env.DB, existing.id, toRemove),
      ...claimItemsStmts(env.DB, existing.id, toAdd),
      ...attach,
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.update',
        target: next.title,
        before,
        after,
      }),
    ],
    existing.id,
    toAdd,
  );
  // Kolom hasil ekspor tidak ikut ditulis di atas: DTO memakai nilainya yang terbaru, bukan salinan awal.
  const settled = (await listQrDesigns(env)).find((row) => row.id === existing.id);
  const saved: NewQrDesignRecord = settled
    ? {
        ...next,
        exportedHash: settled.exportedHash,
        exportedAt: settled.exportedAt,
        exportedBy: settled.exportedBy,
        exportPdfDriveId: settled.exportPdfDriveId,
        exportPngDriveId: settled.exportPngDriveId,
      }
    : next;
  return {
    dto: await viewOf(saved),
    released:
      existing.documentId !== '' && existing.documentId !== next.documentId
        ? [existing.documentId]
        : [],
  };
}

function itemTakenMessage(
  item: { brand: string; model: string },
  designName: string | undefined,
): string {
  return `Item "${item.brand} ${item.model}" sudah tergabung ke Manual Book "${designName ?? 'lain'}"; keluarkan dulu dari sana`;
}

/**
 * Menulis konfigurasi beserta pemasangan item dalam SATU transaksi. Penjaga yang gagal (versi usang atau item yang
 * direbut konfigurasi lain pada saat yang sama) membatalkan seluruhnya; bila penyebabnya item yang kini dimiliki
 * konfigurasi lain, pesan menyebut Manual Book itu.
 */
async function runItemBatch(
  env: Env,
  statements: DbStatement[],
  designId: string,
  claimedIds: readonly string[],
): Promise<void> {
  try {
    await runGuardedBatch(env.DB, statements, staleError);
  } catch (error) {
    if (claimedIds.length > 0 && (error as { stale?: boolean }).stale === true) {
      const now = await findItemsById(env.DB, claimedIds);
      const taken = claimedIds
        .map((id) => now.get(id))
        .find((item) => item !== undefined && item.designId !== '' && item.designId !== designId);
      if (taken) {
        const message = itemTakenMessage(
          taken,
          (await designNamesOf(env.DB, [taken.designId])).get(taken.designId),
        );
        throw appError('CONFLICT', message, { itemIds: message });
      }
    }
    throw error;
  }
}

/** Masa tenggang unggahan yang belum dipakai konfigurasi mana pun sebelum berbaginya dicabut. */
export const QR_ORPHAN_GRACE_MS = 60 * 60 * 1000;
/** Maksimum pencabutan per pemanggilan (tiap pencabutan = satu panggilan jembatan; batas subrequest). */
export const QR_REVOKE_MAX_PER_RUN = 15;

/**
 * Mengganti nama berkas PDF sumber di Drive menjadi "{title}-{subtitle}-{timestamp}.pdf" (id dan URL tetap).
 * Best-effort: pemanggil membungkusnya dengan `afterQrCommit`.
 */
async function renameQrDocument(
  env: Env,
  documentId: string,
  title: string,
  subtitle: string,
): Promise<void> {
  const doc = (await listQrDocuments(env)).find((row) => row.id === documentId);
  if (!doc) return;
  const name = qrPdfFileName(title, subtitle, nowOf(env));
  await viaBridge(() => getBridge(env).renameFile(doc.driveId, name));
  await env.DB.batch([updateQrDocumentStmt(env.DB, { ...doc, name })]);
}

/** Membagikan (lagi) PDF yang sebelumnya dicabut berbaginya. */
async function ensureQrDocumentShared(env: Env, documentId: string): Promise<void> {
  const doc = (await listQrDocuments(env)).find((row) => row.id === documentId);
  if (!doc || doc.shared) return;
  await viaBridge(() => getBridge(env).shareAnyoneWithLink(doc.driveId));
  await env.DB.batch([updateQrDocumentStmt(env.DB, { ...doc, shared: true })]);
}

/** Galat pencabutan berbagi yang sudah dicatat, per `Env` (satu per proses di produksi). */
const revokeLogged = new WeakMap<Env, Set<string>>();

/**
 * Mencabut berbagi publik PDF sumber yang tidak dipakai konfigurasi mana pun: segera untuk dokumen yang baru
 * dilepas (`releasedIds`), dan setelah masa tenggang untuk unggahan yatim. Galat jembatan hanya dicatat dan
 * dokumen tetap bertanda terbagi agar pembersihan berikutnya mencoba lagi. Mengembalikan jumlah yang dicabut.
 */
export async function revokeUnusedQrDocuments(
  env: Env,
  releasedIds: readonly string[],
  limit = QR_REVOKE_MAX_PER_RUN,
): Promise<number> {
  const [designs, documents] = await Promise.all([listQrDesigns(env), listQrDocuments(env)]);
  const used = new Set(
    designs.flatMap((design) =>
      design.linkSource === 'pdf' && design.documentId !== '' ? [design.documentId] : [],
    ),
  );
  const now = nowOf(env);
  let revoked = 0;
  for (const doc of documents) {
    if (revoked >= limit) break;
    if (!doc.shared || used.has(doc.id)) continue;
    const age = now - Date.parse(doc.updatedAt);
    if (!releasedIds.includes(doc.id) && !(age >= QR_ORPHAN_GRACE_MS)) continue;
    try {
      await getBridge(env).revokeSharing(doc.driveId);
      await env.DB.batch([updateQrDocumentStmt(env.DB, { ...doc, shared: false })]);
      revoked += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pembersihan berjalan tiap jam: galat yang sama untuk dokumen yang sama dicatat sekali per proses.
      const seen = revokeLogged.get(env) ?? new Set<string>();
      revokeLogged.set(env, seen);
      const key = `${doc.driveId}|${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.error(`qrcode: berbagi PDF ${doc.driveId} tidak dapat dicabut: ${message}`);
      }
    }
  }
  return revoked;
}

/** Pembersihan terjadwal (cron): mencabut unggahan yatim yang lewat masa tenggang. */
export function cleanupQrDocuments(env: Env, limit = QR_REVOKE_MAX_PER_RUN): Promise<number> {
  return revokeUnusedQrDocuments(env, [], limit);
}

export async function removeQrDesign(
  env: Env,
  input: QrDesignRefInput,
  actor: ActorRef,
): Promise<QrDesignRefInput> {
  const design = (await listQrDesigns(env)).find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  const hasStickerMessage =
    'Konfigurasi sudah punya stiker Manual Book dan tidak dapat dihapus; stiker lama dinonaktifkan di katalog';
  if (await designHasVersions(env.DB, design.id)) throw appError('CONFLICT', hasStickerMessage);
  const [documents, attached] = await Promise.all([qrDocumentMap(env), listAttachedItems(env.DB)]);
  const itemIds = (attached.get(design.id) ?? []).map((item) => item.id);
  await runGuardedBatch(
    env.DB,
    [
      // Kunci baris konfigurasi dulu: komit ekspor (tidak menaikkan `updated_at`) memegang kunci yang sama, jadi
      // penjaga berikutnya melihat versi yang baru lahir (hapus dibatalkan) atau komit ekspor menunggu dan
      // mendapati baris sudah terhapus (ekspor basi).
      lockQrDesignRowStmt(env.DB, design.id),
      noVersionsGuardStmt(env.DB, design.id),
      releaseAllItemsStmt(env.DB, design.id),
      deleteQrDesignStmt(env.DB, design.id),
      writeAudit(env.DB, {
        ts: nowIso(env),
        actor: actor.email,
        action: 'qrcode.delete',
        target: design.title,
        before: qrDesignSnapshot(design, documents, itemIds),
        after: null,
      }),
    ],
    () => appError('CONFLICT', hasStickerMessage),
  );
  // I/O Drive sesudah database. Logo dan PDF sumber sengaja tidak dibuang (label tercetak tetap bisa dibuka).
  for (const driveId of [design.exportPdfDriveId, design.exportPngDriveId]) {
    if (driveId === '') continue;
    await afterQrCommit('berkas ekspor', () =>
      getBridge(env)
        .trashFile(driveId)
        .then(() => dropCachedFile(env, driveId)),
    );
  }
  await afterQrCommit('pencabutan berbagi', () =>
    revokeUnusedQrDocuments(env, design.documentId !== '' ? [design.documentId] : []),
  );
  return { id: design.id };
}

function toQrDocumentDto(doc: QrDocumentRecord): QrDocumentDto {
  return { id: doc.id, name: doc.name, link: driveShareUrl(doc.driveId) };
}

/**
 * Unggah PDF sumber, atau ganti isi PDF yang ada dengan id Drive (dan URL) yang SAMA agar label tercetak tetap
 * valid. Drive DULU lewat jembatan, lalu catatan database.
 */
export async function uploadQrPdf(
  env: Env,
  input: UploadQrPdfInput,
  actor: ActorRef,
): Promise<QrDocumentDto> {
  const out = await uploadQrPdfNow(
    env,
    {
      name: input.name,
      base64: bytesToBase64(input.bytes),
      replaceDocumentId: input.replaceDocumentId,
    },
    actor,
  );
  // Pembersihan oportunistik: unggahan yatim yang sudah melewati masa tenggang dicabut berbaginya.
  await afterQrCommit('pencabutan berbagi', () => revokeUnusedQrDocuments(env, []));
  return out;
}

function limitQrDocumentName(name: string): string {
  return name.length <= QR_LIMITS.documentName ? name : name.slice(0, QR_LIMITS.documentName);
}

/**
 * Menyalin berkas PDF Drive (link atau fileId) ke folder dokumen aplikasi dan membagikannya: salinan menjadi PDF
 * sumber dengan URL tetap yang isinya dapat diganti kemudian. Berkas asli tidak diubah.
 */
export async function cloneQrPdfFromDrive(
  env: Env,
  input: CloneQrPdfInput,
  actor: ActorRef,
): Promise<QrDocumentDto> {
  const bridge = getBridge(env);
  const sourceId = parseDriveFileId(input.source);
  if (sourceId === null) {
    const message = 'Isi dengan link atau ID berkas Google Drive';
    throw appError('VALIDATION', message, { source: message });
  }
  const resourceKey = parseDriveResourceKey(input.source) ?? undefined;
  const info = await viaBridge(() => bridge.externalFileInfo(sourceId, resourceKey));
  if (!info) {
    throw appError(
      'NOT_FOUND',
      'Berkas Drive tidak ditemukan atau tidak dapat diakses akun pemilik aplikasi',
    );
  }
  if (info.mime !== 'application/pdf') throw appError('VALIDATION', 'Berkas Drive bukan PDF');
  if (info.size > QR_LIMITS.documentMaxBytes) {
    throw appError('VALIDATION', 'Ukuran PDF maksimal 10 MB');
  }
  const name = limitQrDocumentName(info.name);
  if (input.replaceDocumentId) {
    // Ganti isi PDF yang ada (URL tetap) dengan isi berkas Drive; berkas asli tidak diubah.
    const content = await viaBridge(() => bridge.readExternalFile(sourceId, resourceKey));
    const isPdf = content?.mime === 'application/pdf' && content.base64.startsWith('JVBERi0'); // "%PDF-"
    if (!content || !isPdf) {
      throw appError('VALIDATION', 'Berkas Drive bukan PDF yang dapat dibaca');
    }
    const out = await uploadQrPdfNow(
      env,
      { name, base64: content.base64, replaceDocumentId: input.replaceDocumentId },
      actor,
    );
    return out;
  }
  const folderId = await ensureQrDocFolder(env);
  const driveId = await viaBridge(() => bridge.copyFile(sourceId, folderId, name, resourceKey));
  try {
    await viaBridge(() => bridge.shareAnyoneWithLink(driveId));
    const now = nowIso(env);
    const record: QrDocumentRecord = {
      id: crypto.randomUUID(),
      driveId,
      name,
      size: info.size,
      shared: true,
      createdAt: now,
      createdBy: actor.email,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await env.DB.batch([
      insertQrDocumentStmt(env.DB, record),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.pdf_clone',
        target: name,
        before: null,
        after: { name, size: info.size, sourceFileId: sourceId },
      }),
    ]);
    return toQrDocumentDto(record);
  } catch (error) {
    await afterQrCommit('pembersihan salinan', () =>
      bridge.trashFile(driveId).then(() => dropCachedFile(env, driveId)),
    );
    throw error;
  }
}

/** PDF sumber dalam base64 (bentuk yang diteruskan ke jembatan Google). */
interface QrPdfBase64Input {
  name: string;
  base64: string;
  replaceDocumentId?: string;
}

async function uploadQrPdfNow(
  env: Env,
  input: QrPdfBase64Input,
  actor: ActorRef,
): Promise<QrDocumentDto> {
  const bridge = getBridge(env);
  const size = base64ByteLength(input.base64);
  if (input.replaceDocumentId) {
    const current = (await listQrDocuments(env)).find((doc) => doc.id === input.replaceDocumentId);
    if (!current) throw appError('NOT_FOUND', 'PDF tidak ditemukan');
    try {
      await bridge.replaceFileContent(current.driveId, 'application/pdf', input.base64);
      await dropCachedFile(env, current.driveId);
    } catch (error) {
      console.error(
        `qrcode: ganti PDF gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw appError(
        'INTERNAL',
        'Isi PDF tidak dapat diganti di Drive; URL lama tetap dipakai dan berkas lama tidak diubah',
      );
    }
    const now = nowIso(env);
    const updated: QrDocumentRecord = {
      ...current,
      name: input.name,
      size,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await env.DB.batch([
      updateQrDocumentStmt(env.DB, updated),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.pdf_upload',
        target: input.name,
        before: { name: current.name, size: current.size },
        after: { name: input.name, size, replaced: true },
      }),
    ]);
    return toQrDocumentDto(updated);
  }
  const folderId = await ensureQrDocFolder(env);
  const driveId = await viaBridge(() =>
    bridge.createFile(folderId, input.name, 'application/pdf', input.base64),
  );
  try {
    await viaBridge(() => bridge.shareAnyoneWithLink(driveId));
    const now = nowIso(env);
    const record: QrDocumentRecord = {
      id: crypto.randomUUID(),
      driveId,
      name: input.name,
      size,
      shared: true,
      createdAt: now,
      createdBy: actor.email,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await env.DB.batch([
      insertQrDocumentStmt(env.DB, record),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.pdf_upload',
        target: input.name,
        before: null,
        after: { name: input.name, size, replaced: false },
      }),
    ]);
    return toQrDocumentDto(record);
  } catch (error) {
    await afterQrCommit('pembersihan unggahan', () =>
      bridge.trashFile(driveId).then(() => dropCachedFile(env, driveId)),
    );
    throw error;
  }
}

/** Isi hasil ekspor (PDF/PNG) sebagai byte; `etag` = sidik id berkas Drive (berubah tiap ekspor ulang). */
/** Stempel waktu nama berkas ekspor: digit tanggal dan waktu saja (tanpa tanda baca). */
export function exportStamp(isoTime: string): string {
  return isoTime.replace(/[-:.TZ]/g, '');
}

export async function readQrFile(env: Env, input: QrFileInput): Promise<QrFileDto> {
  const design = (await listQrDesigns(env)).find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  const driveId = input.kind === 'pdf' ? design.exportPdfDriveId : design.exportPngDriveId;
  if (driveId === '') throw appError('NOT_FOUND', 'Konfigurasi ini belum diekspor');
  const folderId = await folderIdOf(env, QR_FOLDER_SETTING);
  // Izin dan rujukan konfigurasi sudah diperiksa di atas; baru sesudahnya cache memori proses dibaca.
  const content = folderId
    ? await cachedFileContent(env, folderId, driveId, async () => {
        const read = await viaBridge(() => getBridge(env).readFile(driveId, folderId));
        return read ? { mime: read.mime, base64: read.base64 } : null;
      })
    : null;
  if (!content) throw appError('NOT_FOUND', 'Berkas hasil ekspor tidak ditemukan di Drive');
  return {
    filename: `${
      design.name !== ''
        ? manualBookFileName(design.name, exportStamp(design.exportedAt))
        : labelFileName(design.title, design.subtitle)
    }.${input.kind}`,
    mime: content.mime,
    bytes: base64ToBytes(content.base64),
    etag: await shortDigest(driveId),
  };
}
