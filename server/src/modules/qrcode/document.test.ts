import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { bytesOfBase64 } from '@server-test/bytes';
import { qrRpc, seedQrEnv } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import {
  ensureQrDocFolder,
  ensureQrFolder,
  QR_DOC_FOLDER_SETTING,
  QR_FOLDER_SETTING,
} from './folders';

let env: TestEnv;
const realError = console.error;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

const call = (email: string, method: string, payload: unknown) =>
  qrRpc(env, email, method, payload);
const PDF1 = 'JVBERi0xLjQK';
const PDF2 = 'JVBERi0xLjUK';
const upload = (payload: Record<string, unknown>, email = 'qredit@gmail.com') =>
  call(email, 'qrcodes.uploadPdf', { name: 'manual.pdf', bytes: bytesOfBase64(PDF1), ...payload });
async function docs() {
  const rows = await env.DB.prepare(
    'SELECT id, drive_id, name, size, shared FROM qr_documents ORDER BY created_at, id',
  ).all<{
    id: string;
    drive_id: string;
    name: string;
    size: number;
    shared: string;
  }>();
  return rows.results;
}
async function audits() {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((r) => r.action);
}

describe('unggah PDF sumber', () => {
  test('berkas di folder dokumen, dibagikan via link, URL berbagi dikembalikan, audit qrcode.pdf_upload', async () => {
    const out = await upload({});
    expect(out.ok).toBe(true);
    const doc = (await docs())[0];
    if (!doc) throw new Error('dokumen kosong');
    expect(out.data).toMatchObject({
      name: 'manual.pdf',
      link: `https://drive.google.com/file/d/${doc.drive_id}/view`,
    });
    const file = env.BRIDGE.state.files.get(doc.drive_id);
    expect(file).toMatchObject({ mime: 'application/pdf', base64: PDF1, shared: true });
    const folder = await env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
      .bind(QR_DOC_FOLDER_SETTING)
      .first<{ value: string }>();
    expect(file?.folderId).toBe(folder?.value);
    expect(await audits()).toEqual(['qrcode.pdf_upload']);
  });

  test('izin: hanya edit ke atas; view dan tanpa modul ditolak', async () => {
    expect((await upload({}, 'qrview@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await upload({}, 'noqr@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await upload({}, 'qrmanage@gmail.com')).ok).toBe(true);
  });

  test('bukan PDF atau terlalu besar ditolak sebelum menyentuh Drive', async () => {
    expect((await upload({ bytes: bytesOfBase64('QUJDRA==') })).error.code).toBe('VALIDATION');
    expect(env.BRIDGE.state.files.size).toBe(0);
  });

  test('ganti: id dokumen, id berkas Drive, dan URL tetap sama; isi dan nama berubah', async () => {
    const first = await upload({});
    const driveId = (await docs())[0]?.drive_id ?? '';
    const second = await upload({
      name: 'baru.pdf',
      bytes: bytesOfBase64(PDF2),
      replaceDocumentId: first.data.id,
    });
    expect(second.ok).toBe(true);
    expect(second.data).toMatchObject({
      id: first.data.id,
      link: first.data.link,
      name: 'baru.pdf',
    });
    expect(await docs()).toHaveLength(1);
    expect((await docs())[0]?.drive_id).toBe(driveId);
    expect(env.BRIDGE.state.files.get(driveId)?.base64).toBe(PDF2);
    expect(env.BRIDGE.state.files.size).toBe(1);
  });

  test('ganti dokumen tak dikenal -> NOT_FOUND; satu PDF hanya untuk satu konfigurasi QR', async () => {
    expect((await upload({ replaceDocumentId: 'tidak-ada' })).error.code).toBe('NOT_FOUND');
    const doc = await upload({});
    const body = {
      title: 'T',
      linkSource: 'pdf',
      link: '',
      documentId: doc.data.id,
      subtitle: '',
      footer: '',
      logoFileId: '',
      layout: DEFAULT_QR_LAYOUT,
      style: DEFAULT_QR_STYLE,
    };
    expect((await call('qredit@gmail.com', 'qrcodes.save', body)).ok).toBe(true);
    expect(
      (await call('qredit@gmail.com', 'qrcodes.save', { ...body, title: 'T2' })).error.code,
    ).toBe('VALIDATION');
    expect((await upload({ replaceDocumentId: doc.data.id })).data.id).toBe(doc.data.id);
  });

  test('gagal membagikan: berkas yang baru dibuat dibuang dan tidak ada catatan dokumen', async () => {
    env.BRIDGE.shareAnyoneWithLink = async () => {
      throw new Error('gagal bagikan');
    };
    expect((await upload({})).ok).toBe(false);
    expect(await docs()).toHaveLength(0);
    expect([...env.BRIDGE.state.files.values()].every((file) => file.trashed)).toBe(true);
  });

  test('database gagal setelah Drive sukses: berkas Drive dibuang (best effort), tidak ada catatan', async () => {
    // trigger yang menolak INSERT: penyisipan gagal setelah berkas Drive terbuat (dibuang di finally,
    // karena skema tes dipakai ulang antar-tes dan TRUNCATE tidak menghapus trigger)
    await env.DB.exec(
      "CREATE TRIGGER qr_documents_tes_gagal BEFORE INSERT ON qr_documents FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tes: insert ditolak'",
    );
    try {
      const out = await upload({});
      expect(out.ok).toBe(false);
      expect([...env.BRIDGE.state.files.values()].every((file) => file.trashed)).toBe(true);
      expect(await docs()).toHaveLength(0);
    } finally {
      await env.DB.exec('DROP TRIGGER IF EXISTS qr_documents_tes_gagal');
    }
  });

  test('gagal mengganti isi: ditolak dengan pesan jelas, dokumen lama tidak berubah', async () => {
    const first = await upload({});
    const driveId = (await docs())[0]?.drive_id ?? '';
    env.BRIDGE.replaceFileContent = async () => {
      throw new Error('Drive API 403');
    };
    const out = await upload({ bytes: bytesOfBase64(PDF2), replaceDocumentId: first.data.id });
    expect(out.ok).toBe(false);
    expect(env.BRIDGE.state.files.get(driveId)?.base64).toBe(PDF1);
    expect((await docs())[0]?.name).toBe('manual.pdf');
  });
});

describe('clone dari Drive', () => {
  const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123456789';
  const seedForeign = (mime = 'application/pdf', base64 = PDF1) =>
    env.BRIDGE.seedExternal(DRIVE_ID, { name: 'FM BAK.09.pdf', mime, base64 });
  const clone = (source: string, email = 'qredit@gmail.com') =>
    call(email, 'qrcodes.cloneFromDrive', { source });

  test('link Drive atau fileId disalin ke folder dokumen aplikasi, dibagikan, audit qrcode.pdf_clone; berkas asli tidak disentuh', async () => {
    seedForeign();
    const out = await clone(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`);
    expect(out.ok).toBe(true);
    const doc = (await docs())[0];
    expect(doc?.drive_id).not.toBe(DRIVE_ID);
    expect(env.BRIDGE.state.files.get(doc?.drive_id ?? '')?.shared).toBe(true);
    expect(env.BRIDGE.state.external.get(DRIVE_ID)).toBeDefined();
    expect(out.data.link).toContain(doc?.drive_id);
    expect(await audits()).toEqual(['qrcode.pdf_clone']);
    expect((await clone(DRIVE_ID)).ok).toBe(true);
  });

  test('ditolak: bukan link/ID Drive, berkas tidak ada, bukan PDF, terlalu besar, atau tanpa izin edit', async () => {
    expect((await clone('https://contoh.com/a')).error.code).toBe('VALIDATION');
    expect((await clone(DRIVE_ID)).error.code).toBe('NOT_FOUND');
    seedForeign('image/png');
    expect((await clone(DRIVE_ID)).error.message).toContain('PDF');
    seedForeign('application/pdf', `JVBERi0x${'A'.repeat(14_000_000)}`);
    expect((await clone(DRIVE_ID)).error.message).toContain('10 MB');
    seedForeign();
    expect((await clone(DRIVE_ID, 'qrview@gmail.com')).error.code).toBe('FORBIDDEN');
    expect(await docs()).toHaveLength(0);
  });

  test('link berkunci (resourcekey): kunci diteruskan ke Drive saat memeriksa dan menyalin', async () => {
    seedForeign();
    const out = await clone(
      `https://drive.google.com/file/d/${DRIVE_ID}/view?resourcekey=0-AbC_d-1`,
    );
    expect(out.ok).toBe(true);
    const keys = env.BRIDGE.calls
      .filter((c) => c.action === 'externalFileInfo' || c.action === 'copyFile')
      .map((c) => c.args.at(-1));
    expect(keys).toEqual(['0-AbC_d-1', '0-AbC_d-1']);
  });

  test('replaceDocumentId: isi PDF yang ada diganti dari Drive, URL tetap, berkas asli tidak disentuh', async () => {
    const first = await upload({ name: 'lama.pdf', bytes: bytesOfBase64(PDF1) });
    const driveId = (await docs())[0]?.drive_id ?? '';
    seedForeign('application/pdf', PDF2);
    const out = await call('qredit@gmail.com', 'qrcodes.cloneFromDrive', {
      source: DRIVE_ID,
      replaceDocumentId: first.data.id,
    });
    expect(out.ok).toBe(true);
    expect(out.data.id).toBe(first.data.id);
    expect(out.data.link).toBe(first.data.link);
    expect(await docs()).toHaveLength(1);
    expect(env.BRIDGE.state.files.get(driveId)?.base64).toBe(PDF2);
    expect(env.BRIDGE.state.external.get(DRIVE_ID)?.base64).toBe(PDF2);
    expect(
      (
        await call('qredit@gmail.com', 'qrcodes.cloneFromDrive', {
          source: DRIVE_ID,
          replaceDocumentId: 'x',
        })
      ).error.code,
    ).toBe('NOT_FOUND');
  });
});

describe('folder QR', () => {
  test('dibuat bila setting kosong, idempoten, dan terpisah dari folder dokumen', async () => {
    const a = await ensureQrFolder(env);
    const b = await ensureQrDocFolder(env);
    expect(a).not.toBe(b);
    const row = await env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
      .bind(QR_FOLDER_SETTING)
      .first<{ value: string }>();
    expect(row?.value).toBe(a);
    expect(await ensureQrFolder(env)).toBe(a);
  });

  test('setting terisi tetapi folder tidak terakses: galat dan setting TIDAK ditimpa (FS13)', async () => {
    await env.DB.prepare("INSERT INTO settings (`key`, value) VALUES (?, 'folder-hilang')")
      .bind(QR_FOLDER_SETTING)
      .run();
    await expect(ensureQrFolder(env)).rejects.toThrow('tidak dapat diakses');
    const row = await env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
      .bind(QR_FOLDER_SETTING)
      .first<{ value: string }>();
    expect(row?.value).toBe('folder-hilang');
  });
});
