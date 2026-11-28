import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createVerifyPortsFactory } from './verify-ports';

afterEach(() => {
  spyOn(console, 'warn').mockRestore();
});

describe('createVerifyPortsFactory', () => {
  test('URL kosong -> verifikasi mati tanpa peringatan', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    expect(createVerifyPortsFactory('')).toBeUndefined();
    expect(createVerifyPortsFactory('   ')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('URL tidak valid -> mati dengan satu peringatan yang menyebut variabel, tanpa kata sandi', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      createVerifyPortsFactory('postgres://qc_restore:RAHASIA-XYZ@qc-db:3306/'),
    ).toBeUndefined();
    expect(createVerifyPortsFactory('ISI_OLEH_PEMILIK')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    const text = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(text).toContain('RESTORE_DATABASE_URL');
    expect(text).not.toContain('RAHASIA-XYZ');
  });

  test('URL tingkat server (tanpa nama basis data) valid -> pabrik; koneksi dibuat per pemakaian dan dapat ditutup', async () => {
    const factory = createVerifyPortsFactory('mysql://qc_restore:abc123@127.0.0.1:1/');
    expect(factory).toBeDefined();
    const ports = await (factory as NonNullable<typeof factory>)();
    expect(typeof ports.importSql).toBe('function');
    expect(ports.schemaPrefix).toBeUndefined();
    await ports.close();
  });
});
