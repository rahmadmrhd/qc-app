import { describe, expect, test } from 'bun:test';
import { newId } from '@server/core/id';
import { proofFilename } from '@server/modules/serial/proof/repo';
import { postelAttachmentFilename } from './attachments';

// Nama unduhan turunan dari ID: ULID yang dibuat berdekatan berbagi awalan waktu, jadi nama harus memakai bagian acak.

describe('nama unduhan dari ULID', () => {
  test('ID berurutan dalam milidetik berdekatan menghasilkan nama berkas berbeda', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    const attachmentNames = new Set(
      ids.map((id) => postelAttachmentFilename(id, 'application/pdf')),
    );
    const proofNames = new Set(ids.map((id) => proofFilename(id, 'image/webp')));
    expect(attachmentNames.size).toBe(ids.length);
    expect(proofNames.size).toBe(ids.length);
  });

  test('bentuk nama: awalan, 8 karakter akhir id, ekstensi menurut MIME', () => {
    const id = '01hzx0123456789abcdefghjkm';
    expect(postelAttachmentFilename(id, 'application/pdf')).toBe('lampiran-defghjkm.pdf');
    expect(proofFilename(` ${id} `, 'image/png')).toBe('bukti-defghjkm.png');
  });
});
