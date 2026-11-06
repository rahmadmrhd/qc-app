import { describe, expect, test } from 'bun:test';
import { createFakeBridge } from './fake-bridge';

describe('createFakeBridge', () => {
  test('buat folder, simpan, baca, dan info berkas', async () => {
    const bridge = createFakeBridge();
    const folder = await bridge.createFolder('QC');
    expect(await bridge.folderExists(folder)).toBe(true);
    const id = await bridge.createFile(folder, 'a.png', 'image/png', 'QUJD');
    expect(await bridge.readFile(id, folder)).toEqual({ mime: 'image/png', base64: 'QUJD' });
    expect(await bridge.fileInfo(id, folder)).toEqual({ mime: 'image/png', size: 3 });
  });

  test('readFile/fileInfo dengan folder induk salah mengembalikan null', async () => {
    const bridge = createFakeBridge();
    const a = await bridge.createFolder('A');
    const b = await bridge.createFolder('B');
    const id = await bridge.createFile(a, 'a.txt', 'text/plain', 'QQ==');
    expect(await bridge.readFile(id, b)).toBeNull();
    expect(await bridge.fileInfo(id, b)).toBeNull();
    expect(await bridge.readFile('tidak-ada', a)).toBeNull();
  });

  test('ganti isi mempertahankan id; ganti nama; berbagi dan cabut', async () => {
    const bridge = createFakeBridge();
    const folder = await bridge.createFolder('QC');
    const id = await bridge.createFile(folder, 'a.pdf', 'application/pdf', 'QQ==');
    await bridge.replaceFileContent(id, 'application/pdf', 'QUJDRA==');
    expect((await bridge.readFile(id, folder))?.base64).toBe('QUJDRA==');
    await bridge.renameFile(id, 'b.pdf');
    expect(bridge.state.files.get(id)?.name).toBe('b.pdf');
    await bridge.shareAnyoneWithLink(id);
    expect(bridge.state.files.get(id)?.shared).toBe(true);
    await bridge.revokeSharing(id);
    expect(bridge.state.files.get(id)?.shared).toBe(false);
    await bridge.revokeSharing('hilang');
  });

  test('tempat sampah: trashFile menyembunyikan berkas; aman bila tak ada', async () => {
    const bridge = createFakeBridge();
    const folder = await bridge.createFolder('QC');
    const id = await bridge.createFile(folder, 'a', 'text/plain', 'QQ==');
    await bridge.trashFile(id);
    expect(await bridge.readFile(id, folder)).toBeNull();
    await bridge.trashFile('hilang');
  });

  test('salin dan berkas eksternal', async () => {
    const bridge = createFakeBridge();
    const folder = await bridge.createFolder('QC');
    bridge.seedExternal('ext1', { name: 'sumber.pdf', mime: 'application/pdf', base64: 'QUJD' });
    expect(await bridge.externalFileInfo('ext1')).toEqual({
      name: 'sumber.pdf',
      mime: 'application/pdf',
      size: 3,
    });
    expect(await bridge.readExternalFile('ext1')).toEqual({
      mime: 'application/pdf',
      base64: 'QUJD',
    });
    expect(await bridge.externalFileInfo('nope')).toBeNull();
    const copy = await bridge.copyFile('ext1', folder, 'salinan.pdf');
    expect(await bridge.readFile(copy, folder)).toEqual({
      mime: 'application/pdf',
      base64: 'QUJD',
    });
    await expect(bridge.copyFile('nope', folder, 'x')).rejects.toThrow();
    await expect(bridge.renameFile('nope', 'x')).rejects.toThrow();
  });

  test('kegagalan dapat disuntik per aksi', async () => {
    const bridge = createFakeBridge();
    bridge.failNext('createFile', new Error('jembatan mati'));
    const folder = await bridge.createFolder('QC');
    await expect(bridge.createFile(folder, 'a', 'text/plain', 'QQ==')).rejects.toThrow(
      'jembatan mati',
    );
    await bridge.createFile(folder, 'a', 'text/plain', 'QQ==');
    expect(bridge.calls.map((c) => c.action)).toEqual(['createFolder', 'createFile', 'createFile']);
  });

  test('sheets: dump dan export', async () => {
    const bridge = createFakeBridge();
    bridge.state.dump = { users: [['id'], ['1']] };
    expect(await bridge.sheetsDump()).toEqual({ users: [['id'], ['1']] });
    await bridge.sheetsExport({ sheet: 'items', columns: ['id'], rows: [['1']], mode: 'replace' });
    expect(bridge.state.exports).toHaveLength(1);
  });
  test('metode cadangan: uploadFile, listFolder berhalaman, downloadFile, deleteFile, storageQuota', async () => {
    const bridge = createFakeBridge();
    const folder = await bridge.createFolder('Cadangan');
    const bytes = new TextEncoder().encode('isi cadangan');
    const uploaded = await bridge.uploadFile(
      folder,
      'qc-backup-b.sql.gz',
      'application/gzip',
      new Blob([bytes]),
      {
        appProperties: { sha256: 'x' },
      },
    );
    expect(uploaded).toMatchObject({ size: bytes.length });
    expect(uploaded.md5Checksum).toMatch(/^[0-9a-f]{32}$/);
    await bridge.uploadFile(folder, 'qc-backup-a.sql.gz', 'application/gzip', bytes);
    const first = await bridge.listFolder(folder, { pageSize: 1 });
    expect(first.files.map((f) => f.name)).toEqual(['qc-backup-a.sql.gz']);
    const second = await bridge.listFolder(folder, { pageSize: 1, pageToken: first.nextPageToken });
    expect(second.files[0]).toMatchObject({
      name: 'qc-backup-b.sql.gz',
      appProperties: { sha256: 'x' },
    });
    expect(second.nextPageToken).toBeUndefined();
    const download = await bridge.downloadFile(uploaded.id, folder);
    expect(new Uint8Array(await new Response(download?.body).arrayBuffer())).toEqual(bytes);
    expect(await bridge.downloadFile('hilang', folder)).toBeNull();
    await bridge.deleteFile(uploaded.id);
    expect(bridge.state.files.has(uploaded.id)).toBe(false);
    await bridge.deleteFile(uploaded.id);
    expect(await bridge.storageQuota()).toEqual({ limit: null, usage: 0 });
  });
});
