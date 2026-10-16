import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { attachFiles_ } from '@gas/modules/files/service';
import { base64ByteLength } from '@shared/files';
import type { QrContent } from '@shared/qrcode';
import {
  DEFAULT_QR_STYLE,
  driveShareUrl,
  labelFileSlug,
  qrContentHash,
  qrExportStatus,
} from '@shared/qrcode';
import type {
  ExportQrDesignInput,
  QrDesignDto,
  QrDesignRefInput,
  QrDocumentDto,
  QrFileDto,
  QrFileInput,
  SaveQrDesignInput,
  UploadQrPdfInput,
} from '@shared/rpc';
import { ensureQrDocFolder_, ensureQrFolder_, QR_FOLDER_PROPERTY } from './folders';
import type { NewQrDesignRecord, QrDesignRecord, QrDocumentRecord } from './repo';
import {
  deleteQrDesign_,
  insertQrDesign_,
  insertQrDocument_,
  listQrDesigns_,
  listQrDocuments_,
  updateQrDesign_,
  updateQrDocument_,
} from './repo';

const QR_STALE_MESSAGE =
  'Konfigurasi sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

/** Link efektif: URL yang diketik, atau URL berbagi PDF sumber (kosong bila dokumen hilang). */
export function qrEffectiveLink_(
  design: Pick<NewQrDesignRecord, 'linkSource' | 'link' | 'documentId'>,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): string {
  if (design.linkSource === 'url') return design.link;
  const doc = documents.get(design.documentId);
  return doc ? driveShareUrl(doc.driveId) : '';
}

export function qrDesignContent_(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): QrContent {
  return {
    linkSource: design.linkSource,
    link: qrEffectiveLink_(design, documents),
    title: design.title,
    subtitle: design.subtitle,
    footer: design.footer,
    logoFileId: design.logoFileId,
    layout: design.layout,
    style: design.style,
  };
}

function qrDocumentMap_(): Map<string, QrDocumentRecord> {
  return new Map(listQrDocuments_().map((doc) => [doc.id, doc]));
}

function qrUsesMap_(designs: readonly QrDesignRecord[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const design of designs) {
    if (design.linkSource === 'pdf' && design.documentId !== '') {
      uses.set(design.documentId, (uses.get(design.documentId) ?? 0) + 1);
    }
  }
  return uses;
}

export function toQrDesignDto_(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
  uses: ReadonlyMap<string, number>,
): QrDesignDto {
  const content = qrDesignContent_(design, documents);
  return {
    id: design.id,
    title: design.title,
    linkSource: design.linkSource,
    link: content.link,
    documentId: design.documentId,
    documentName: documents.get(design.documentId)?.name ?? '',
    documentUses: uses.get(design.documentId) ?? 0,
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

export function qrDesignSnapshot_(
  design: NewQrDesignRecord,
  documents: ReadonlyMap<string, QrDocumentRecord>,
): Record<string, unknown> {
  return {
    title: design.title,
    linkSource: design.linkSource,
    link: qrEffectiveLink_(design, documents),
    subtitle: design.subtitle,
    footer: design.footer,
    logo: design.logoFileId === '' ? 'tanpa' : design.logoFileId,
    layout: JSON.stringify(design.layout),
    frame: design.style.frame.kind,
    style: JSON.stringify(design.style),
  };
}

export function listQrDesignDtos_(): QrDesignDto[] {
  const designs = listQrDesigns_();
  const documents = qrDocumentMap_();
  const uses = qrUsesMap_(designs);
  return designs
    .map((design) => toQrDesignDto_(design, documents, uses))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export function getQrDesignDto_(input: QrDesignRefInput): QrDesignDto {
  const designs = listQrDesigns_();
  const design = designs.find((row) => row.id === input.id);
  if (!design) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  return toQrDesignDto_(design, qrDocumentMap_(), qrUsesMap_(designs));
}

export function saveQrDesign_(input: SaveQrDesignInput, actor: ActorRef): QrDesignDto {
  // Berbagi PDF (I/O Drive) di luar lock: PDF yang sebelumnya dicabut dibagikan lagi saat dipakai.
  if (input.linkSource === 'pdf') ensureQrDocumentShared_(input.documentId);
  const { dto, released } = saveQrDesignLocked_(input, actor);
  revokeUnusedQrDocuments_(released);
  return dto;
}

interface SaveOutcome {
  dto: QrDesignDto;
  /** Dokumen PDF yang baru saja dilepas oleh konfigurasi ini (kandidat pencabutan berbagi). */
  released: string[];
}

function saveQrDesignLocked_(input: SaveQrDesignInput, actor: ActorRef): SaveOutcome {
  return platform_().withLock((): SaveOutcome => {
    const designs = listQrDesigns_();
    const existing = input.id ? designs.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
    if (existing && input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
      throw appError_('CONFLICT', QR_STALE_MESSAGE);
    }
    const documents = qrDocumentMap_();
    if (input.linkSource === 'pdf' && !documents.has(input.documentId)) {
      const message = 'PDF tidak dikenal; unggah ulang';
      throw appError_('VALIDATION', message, { documentId: message });
    }
    const now = nowIso_();
    const next: NewQrDesignRecord = {
      id: existing?.id ?? platform_().uuid(),
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
    if (next.logoFileId !== '') attachFiles_([next.logoFileId], 'qrlogo', 'shared');

    if (!existing) {
      insertQrDesign_(next);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'qrcode.create',
        target: next.title,
        before: null,
        after: qrDesignSnapshot_(next, documents),
      });
      return {
        dto: toQrDesignDto_(next, documents, qrUsesMap_([...designs, { ...next, rowNumber: 0 }])),
        released: [],
      };
    }
    const before = qrDesignSnapshot_(existing, documents);
    const after = qrDesignSnapshot_(next, documents);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      // Hanya flag "tidak muat" (laporan peramban) yang berubah: simpan diam-diam, tanpa audit dan tanpa
      // menaikkan updatedAt (agar versi yang sedang dimuat pengguna lain tidak jadi basi).
      if (existing.overflow !== next.overflow) {
        const flagged: QrDesignRecord = { ...existing, overflow: next.overflow };
        updateQrDesign_(flagged);
        return {
          dto: toQrDesignDto_(
            flagged,
            documents,
            qrUsesMap_(designs.map((row) => (row.id === flagged.id ? flagged : row))),
          ),
          released: [],
        };
      }
      return { dto: toQrDesignDto_(existing, documents, qrUsesMap_(designs)), released: [] };
    }
    const saved: QrDesignRecord = { ...next, rowNumber: existing.rowNumber };
    updateQrDesign_(saved);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'qrcode.update',
      target: saved.title,
      before,
      after,
    });
    return {
      dto: toQrDesignDto_(
        saved,
        documents,
        qrUsesMap_(designs.map((row) => (row.id === saved.id ? saved : row))),
      ),
      released:
        existing.documentId !== '' && existing.documentId !== next.documentId
          ? [existing.documentId]
          : [],
    };
  });
}

/** Masa tenggang unggahan yang belum dipakai konfigurasi mana pun sebelum berbaginya dicabut. */
const QR_ORPHAN_GRACE_MS = 60 * 60 * 1000;

/** Membagikan (lagi) PDF yang sebelumnya dicabut berbaginya. I/O Drive di luar lock; pemanggil tanpa lock. */
function ensureQrDocumentShared_(documentId: string): void {
  const doc = listQrDocuments_().find((row) => row.id === documentId);
  if (!doc || doc.shared) return;
  platform_().driveShareAnyoneWithLink(doc.driveId);
  platform_().withLock(() => {
    const fresh = listQrDocuments_().find((row) => row.id === documentId);
    if (fresh && !fresh.shared) updateQrDocument_({ ...fresh, shared: true });
  });
}

/**
 * Mencabut berbagi publik PDF sumber yang tidak dipakai konfigurasi mana pun: segera untuk dokumen yang baru
 * dilepas (`releasedIds`), dan setelah masa tenggang untuk unggahan yatim. Best-effort: galat Drive hanya dicatat.
 * I/O Drive di luar lock; pemanggil tanpa lock.
 */
function revokeUnusedQrDocuments_(releasedIds: readonly string[]): void {
  const used = new Set(
    listQrDesigns_().flatMap((design) =>
      design.linkSource === 'pdf' && design.documentId !== '' ? [design.documentId] : [],
    ),
  );
  const now = platform_().now();
  const revoked: string[] = [];
  for (const doc of listQrDocuments_()) {
    if (!doc.shared || used.has(doc.id)) continue;
    const age = now - Date.parse(doc.updatedAt);
    if (!releasedIds.includes(doc.id) && !(age >= QR_ORPHAN_GRACE_MS)) continue;
    try {
      platform_().driveRevokeSharing(doc.driveId);
      revoked.push(doc.id);
    } catch (error) {
      platform_().logError(
        `qrcode: berbagi PDF ${doc.driveId} tidak dapat dicabut: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (revoked.length === 0) return;
  platform_().withLock(() => {
    for (const doc of listQrDocuments_()) {
      if (revoked.includes(doc.id) && doc.shared) updateQrDocument_({ ...doc, shared: false });
    }
  });
}

export function removeQrDesign_(input: QrDesignRefInput, actor: ActorRef): QrDesignRefInput {
  const removed = platform_().withLock(() => {
    const design = listQrDesigns_().find((row) => row.id === input.id);
    if (!design) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
    const documents = qrDocumentMap_();
    deleteQrDesign_(design);
    appendAudit_({
      ts: nowIso_(),
      actor: actor.email,
      action: 'qrcode.delete',
      target: design.title,
      before: qrDesignSnapshot_(design, documents),
      after: null,
    });
    return design;
  });
  // I/O Drive di luar lock. Logo dan PDF sumber sengaja tidak dibuang (label tercetak tetap bisa dibuka).
  for (const driveId of [removed.exportPdfDriveId, removed.exportPngDriveId]) {
    if (driveId !== '') platform_().driveTrashFile(driveId);
  }
  revokeUnusedQrDocuments_(removed.documentId !== '' ? [removed.documentId] : []);
  return { id: removed.id };
}

function toQrDocumentDto_(doc: QrDocumentRecord, uses: number): QrDocumentDto {
  return { id: doc.id, name: doc.name, link: driveShareUrl(doc.driveId), uses };
}

function qrDocumentUses_(documentId: string): number {
  return listQrDesigns_().filter((d) => d.linkSource === 'pdf' && d.documentId === documentId)
    .length;
}

/**
 * Unggah PDF sumber, atau ganti isi PDF yang ada dengan id Drive (dan URL) yang SAMA agar label tercetak tetap
 * valid. I/O Drive di luar lock; catatan sheet di dalam lock.
 */
export function uploadQrPdf_(input: UploadQrPdfInput, actor: ActorRef): QrDocumentDto {
  const out = uploadQrPdfNow_(input, actor);
  // Pembersihan oportunistik: unggahan yatim yang sudah melewati masa tenggang dicabut berbaginya.
  revokeUnusedQrDocuments_([]);
  return out;
}

function uploadQrPdfNow_(input: UploadQrPdfInput, actor: ActorRef): QrDocumentDto {
  const platform = platform_();
  const size = base64ByteLength(input.base64);
  if (input.replaceDocumentId) {
    const current = listQrDocuments_().find((doc) => doc.id === input.replaceDocumentId);
    if (!current) throw appError_('NOT_FOUND', 'PDF tidak ditemukan');
    try {
      platform.driveReplaceFileContent(current.driveId, 'application/pdf', input.base64);
    } catch (error) {
      platform_().logError(
        `qrcode: ganti PDF gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw appError_(
        'INTERNAL',
        'Isi PDF tidak dapat diganti di Drive; URL lama tetap dipakai dan berkas lama tidak diubah',
      );
    }
    return platform.withLock(() => {
      const fresh = listQrDocuments_().find((doc) => doc.id === current.id) ?? current;
      const now = nowIso_();
      const updated: QrDocumentRecord = {
        ...fresh,
        name: input.name,
        size,
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateQrDocument_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'qrcode.pdf_upload',
        target: input.name,
        before: { name: fresh.name, size: fresh.size },
        after: { name: input.name, size, replaced: true },
      });
      return toQrDocumentDto_(updated, qrDocumentUses_(updated.id));
    });
  }
  const folderId = ensureQrDocFolder_();
  const driveId = platform.driveCreateFile(folderId, input.name, 'application/pdf', input.base64);
  try {
    platform.driveShareAnyoneWithLink(driveId);
    return platform.withLock(() => {
      const now = nowIso_();
      const record = {
        id: platform_().uuid(),
        driveId,
        name: input.name,
        size,
        shared: true,
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
      };
      insertQrDocument_(record);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'qrcode.pdf_upload',
        target: input.name,
        before: null,
        after: { name: input.name, size, replaced: false },
      });
      return toQrDocumentDto_({ ...record, rowNumber: 0 }, 0);
    });
  } catch (error) {
    platform.driveTrashFile(driveId);
    throw error;
  }
}

function assertQrFresh_(design: QrDesignRecord, expectedUpdatedAt: string): void {
  if (design.updatedAt !== expectedUpdatedAt) throw appError_('CONFLICT', QR_STALE_MESSAGE);
}

/**
 * Ekspor: berkas baru dibuat di Drive DULU (di luar lock), lalu dicatat di dalam lock; berkas lama baru dibuang
 * setelah pencatatan sukses. Gagal di tengah → berkas baru dibersihkan, berkas lama utuh.
 */
export function exportQrDesign_(input: ExportQrDesignInput, actor: ActorRef): QrDesignDto {
  const platform = platform_();
  const precheck = listQrDesigns_().find((row) => row.id === input.id);
  if (!precheck) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  assertQrFresh_(precheck, input.expectedUpdatedAt);
  if (precheck.overflow) {
    throw appError_(
      'VALIDATION',
      'Isi label melebihi kanvas 3 × 3 cm; perbaiki ukuran atau teks lalu simpan ulang',
    );
  }
  const folderId = ensureQrFolder_();
  const stamp = nowIso_().replace(/[-:.TZ]/g, '');
  const base = `${labelFileSlug(precheck.title)}-${stamp}`;
  const created: string[] = [];
  let committed:
    | {
        record: QrDesignRecord;
        previous: QrDesignRecord;
        documents: Map<string, QrDocumentRecord>;
        designs: QrDesignRecord[];
      }
    | undefined;
  try {
    created.push(
      platform.driveCreateFile(folderId, `${base}.pdf`, 'application/pdf', input.pdfBase64),
    );
    created.push(platform.driveCreateFile(folderId, `${base}.png`, 'image/png', input.pngBase64));
    committed = platform.withLock(() => {
      const designs = listQrDesigns_();
      const current = designs.find((row) => row.id === input.id);
      if (!current) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
      assertQrFresh_(current, input.expectedUpdatedAt);
      const documents = qrDocumentMap_();
      const now = nowIso_();
      const updated: QrDesignRecord = {
        ...current,
        exportedHash: qrContentHash(qrDesignContent_(current, documents)),
        exportedAt: now,
        exportedBy: actor.email,
        exportPdfDriveId: created[0] ?? '',
        exportPngDriveId: created[1] ?? '',
      };
      updateQrDesign_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'qrcode.export',
        target: current.title,
        before: { exported: current.exportedAt === '' ? 'belum' : current.exportedAt },
        after: { exported: now, replaced: current.exportPdfDriveId !== '' },
      });
      return { record: updated, previous: current, documents, designs };
    });
  } catch (error) {
    // Gagal SEBELUM pencatatan sukses: berkas baru dibersihkan, berkas lama utuh.
    for (const driveId of created) platform.driveTrashFile(driveId);
    throw error;
  }
  // Setelah pencatatan sukses berkas baru sudah sah: membuang berkas lama bersifat best-effort dan tidak
  // boleh menggagalkan ekspor atau membuang berkas baru.
  for (const driveId of [
    committed.previous.exportPdfDriveId,
    committed.previous.exportPngDriveId,
  ]) {
    if (driveId === '') continue;
    try {
      platform.driveTrashFile(driveId);
    } catch (error) {
      platform.logError(
        `qrcode: berkas ekspor lama ${driveId} tidak dapat dibuang: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return toQrDesignDto_(committed.record, committed.documents, qrUsesMap_(committed.designs));
}

export function readQrFile_(input: QrFileInput): QrFileDto {
  const design = listQrDesigns_().find((row) => row.id === input.id);
  if (!design) throw appError_('NOT_FOUND', 'Konfigurasi tidak ditemukan');
  const driveId = input.kind === 'pdf' ? design.exportPdfDriveId : design.exportPngDriveId;
  if (driveId === '') throw appError_('NOT_FOUND', 'Konfigurasi ini belum diekspor');
  const folderId = platform_().getProperty(QR_FOLDER_PROPERTY)?.trim() ?? '';
  const content = folderId ? platform_().driveReadFile(driveId, folderId) : null;
  if (!content) throw appError_('NOT_FOUND', 'Berkas hasil ekspor tidak ditemukan di Drive');
  return {
    filename: `${labelFileSlug(design.title)}.${input.kind}`,
    mime: content.mime,
    base64: content.base64,
  };
}
