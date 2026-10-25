import { base64ByteLength } from '@shared/files';
import type { QrContent } from '@shared/qrcode';
import {
  clampQrLayout,
  clampQrStyle,
  DEFAULT_QR_STYLE,
  driveShareUrl,
  labelFileName,
  parseDriveFileId,
  parseDriveResourceKey,
  QR_LIMITS,
  qrExportStatus,
  qrPdfFileName,
} from '@shared/qrcode';
import type {
  CloneQrPdfInput,
  QrDefaultsDto,
  QrDesignDto,
  QrDesignRefInput,
  QrDocumentDto,
  QrFileDto,
  QrFileInput,
  QrLogoLibraryDto,
  QrPresetDto,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/rpc';
import { writeAudit } from '@worker/core/audit';
import { getBridge, viaBridge } from '@worker/core/bridge-client';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso, nowOf } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { cachedFileContent, dropCachedFile } from '@worker/core/file-cache';
import { getSetting } from '@worker/core/settings';
import { planAttachFiles } from '@worker/modules/files/service';
import { ensureQrDocFolder, QR_FOLDER_SETTING } from './folders';
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
  runGuardedBatch,
  updateQrDefaultsStmt,
  updateQrDesignStmt,
  updateQrDocumentStmt,
  updateQrPresetStmt,
} from './repo';

export const QR_STALE_MESSAGE =
  'Konfigurasi sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

function staleError(): Error {
  return appError('CONFLICT', QR_STALE_MESSAGE);
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

export function toQrDesignDto(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): QrDesignDto {
  const content = qrDesignContent(design, documents);
  return {
    id: design.id,
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
): Record<string, unknown> {
  return {
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

export async function listQrDesignDtos(env: Env): Promise<QrDesignDto[]> {
  const [designs, documents] = await Promise.all([listQrDesigns(env), qrDocumentMap(env)]);
  return designs
    .map((design) => toQrDesignDto(design, documents))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export async function getQrDesignDto(env: Env, input: QrDesignRefInput): Promise<QrDesignDto> {
  const designs = await listQrDesigns(env);
  const design = designs.find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  return toQrDesignDto(design, await qrDocumentMap(env));
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
  };
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
  const taken = presets.some(
    (row) => row.id !== existing?.id && row.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (taken) {
    const message = 'Nama sudah dipakai konfigurasi default lain';
    throw appError('VALIDATION', message, { name: message });
  }
  if (!existing && presets.length >= QR_LIMITS.presets) {
    throw appError('VALIDATION', `Konfigurasi default maksimal ${QR_LIMITS.presets}`);
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
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.email,
    updatedAt: now,
    updatedBy: actor.email,
  };
  if (!existing) {
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
    return toQrPresetDto(next);
  }
  if (JSON.stringify(qrPresetSnapshot(existing)) === JSON.stringify(qrPresetSnapshot(next))) {
    return toQrPresetDto(existing);
  }
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
  const attach = await planAttachFiles(env, input.logoFileIds, 'qrlogo', 'shared');
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
  actor: ActorRef,
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
  actor: ActorRef,
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
  const now = nowIso(env);
  const next: NewQrDesignRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    title: input.title,
    linkSource: input.linkSource,
    link: input.linkSource === 'url' ? input.link : '',
    documentId: input.linkSource === 'pdf' ? input.documentId : '',
    subtitle: input.subtitle,
    footer: input.footer,
    logoFileId: input.logoFileId,
    layout: input.layout,
    style: input.style ?? existing?.style ?? DEFAULT_QR_STYLE,
    overflow: input.overflow ?? existing?.overflow ?? false,
    exportedHash: existing?.exportedHash ?? '',
    exportedAt: existing?.exportedAt ?? '',
    exportedBy: existing?.exportedBy ?? '',
    exportPdfDriveId: existing?.exportPdfDriveId ?? '',
    exportPngDriveId: existing?.exportPngDriveId ?? '',
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.email,
    updatedAt: now,
    updatedBy: actor.email,
  };
  // Logo bersama: pemilik tetap ('qrlogo','shared') agar banyak konfigurasi boleh merujuk berkas yang sama.
  const attach =
    next.logoFileId !== '' ? await planAttachFiles(env, [next.logoFileId], 'qrlogo', 'shared') : [];

  if (!existing) {
    await env.DB.batch([
      insertQrDesignStmt(env.DB, next),
      ...attach,
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.create',
        target: next.title,
        before: null,
        after: qrDesignSnapshot(next, documents),
      }),
    ]);
    return { dto: toQrDesignDto(next, documents), released: [] };
  }
  const before = qrDesignSnapshot(existing, documents);
  const after = qrDesignSnapshot(next, documents);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    // Hanya flag "tidak muat" (laporan peramban) yang berubah: simpan diam-diam, tanpa audit dan tanpa
    // menaikkan updatedAt (agar versi yang sedang dimuat pengguna lain tidak jadi basi).
    if (existing.overflow !== next.overflow) {
      const flagged: QrDesignRecord = { ...existing, overflow: next.overflow };
      await env.DB.batch([updateQrDesignStmt(env.DB, flagged)]);
      return { dto: toQrDesignDto(flagged, documents), released: [] };
    }
    return { dto: toQrDesignDto(existing, documents), released: [] };
  }
  await runGuardedBatch(
    env.DB,
    [
      updateQrDesignStmt(env.DB, next, existing.updatedAt),
      guardChanged(env.DB),
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
    staleError,
  );
  return {
    dto: toQrDesignDto(next, documents),
    released:
      existing.documentId !== '' && existing.documentId !== next.documentId
        ? [existing.documentId]
        : [],
  };
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
      console.error(
        `qrcode: berbagi PDF ${doc.driveId} tidak dapat dicabut: ${error instanceof Error ? error.message : String(error)}`,
      );
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
  const documents = await qrDocumentMap(env);
  await env.DB.batch([
    deleteQrDesignStmt(env.DB, design.id),
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: actor.email,
      action: 'qrcode.delete',
      target: design.title,
      before: qrDesignSnapshot(design, documents),
      after: null,
    }),
  ]);
  // I/O Drive sesudah D1. Logo dan PDF sumber sengaja tidak dibuang (label tercetak tetap bisa dibuka).
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
 * valid. Drive DULU lewat jembatan, lalu catatan D1.
 */
export async function uploadQrPdf(
  env: Env,
  input: UploadQrPdfInput,
  actor: ActorRef,
): Promise<QrDocumentDto> {
  const out = await uploadQrPdfNow(env, input, actor);
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

async function uploadQrPdfNow(
  env: Env,
  input: UploadQrPdfInput,
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

/** Isi hasil ekspor (PDF/PNG) diteruskan sebagai base64 apa adanya. */
export async function readQrFile(env: Env, input: QrFileInput): Promise<QrFileDto> {
  const design = (await listQrDesigns(env)).find((row) => row.id === input.id);
  if (!design) throw appError('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  const driveId = input.kind === 'pdf' ? design.exportPdfDriveId : design.exportPngDriveId;
  if (driveId === '') throw appError('NOT_FOUND', 'Konfigurasi ini belum diekspor');
  const folderId = await getSetting(env, QR_FOLDER_SETTING);
  // Izin dan rujukan konfigurasi sudah diperiksa di atas; baru sesudahnya cache (R2) dibaca.
  const content = folderId
    ? await cachedFileContent(env, folderId, driveId, async () => {
        const read = await viaBridge(() => getBridge(env).readFile(driveId, folderId));
        return read ? { mime: read.mime, base64: read.base64 } : null;
      })
    : null;
  if (!content) throw appError('NOT_FOUND', 'Berkas hasil ekspor tidak ditemukan di Drive');
  return {
    filename: `${labelFileName(design.title, design.subtitle)}.${input.kind}`,
    mime: content.mime,
    base64: content.base64,
  };
}
