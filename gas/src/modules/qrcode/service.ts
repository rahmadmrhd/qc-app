import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { attachFiles_ } from '@gas/modules/files/service';
import type { QrContent } from '@shared/qrcode';
import { driveShareUrl, qrExportStatus } from '@shared/qrcode';
import type { QrDesignDto, QrDesignRefInput, SaveQrDesignInput } from '@shared/rpc';
import type { NewQrDesignRecord, QrDesignRecord, QrDocumentRecord } from './repo';
import {
  deleteQrDesign_,
  insertQrDesign_,
  listQrDesigns_,
  listQrDocuments_,
  updateQrDesign_,
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
    logo: design.logoFileId === '' ? 'tanpa' : 'ada',
    layout: JSON.stringify(design.layout),
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
  return platform_().withLock(() => {
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
      return toQrDesignDto_(next, documents, qrUsesMap_([...designs, { ...next, rowNumber: 0 }]));
    }
    const before = qrDesignSnapshot_(existing, documents);
    const after = qrDesignSnapshot_(next, documents);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return toQrDesignDto_(existing, documents, qrUsesMap_(designs));
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
    return toQrDesignDto_(
      saved,
      documents,
      qrUsesMap_(designs.map((row) => (row.id === saved.id ? saved : row))),
    );
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
  return { id: removed.id };
}
