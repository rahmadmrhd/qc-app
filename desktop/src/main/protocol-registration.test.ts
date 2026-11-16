import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { devProtocolRegistration } from './protocol-registration';

describe('devProtocolRegistration', () => {
  test('tanpa env QC_DEV_REGISTER_PROTOCOL=1 tidak mendaftar (registri tak disentuh saat pengembangan biasa)', () => {
    expect(devProtocolRegistration({}, 'electron.exe', '.', 'C:data')).toBeNull();
    expect(
      devProtocolRegistration({ QC_DEV_REGISTER_PROTOCOL: '0' }, 'electron.exe', '.', 'C:data'),
    ).toBeNull();
    expect(
      devProtocolRegistration({ QC_DEV_REGISTER_PROTOCOL: 'true' }, 'electron.exe', '.', 'C:data'),
    ).toBeNull();
  });

  test('diminta: biner Electron + folder aplikasi absolut + folder data yang sama', () => {
    const result = devProtocolRegistration(
      { QC_DEV_REGISTER_PROTOCOL: '1' },
      'C:electronelectron.exe',
      '.',
      'C:Usersa bdata',
    );
    expect(result).toEqual({
      execPath: 'C:electronelectron.exe',
      args: [resolve('.'), '--user-data-dir=C:Usersa bdata'],
    });
  });

  test('tanpa entri aplikasi (argv[1]) tidak mendaftar', () => {
    expect(
      devProtocolRegistration({ QC_DEV_REGISTER_PROTOCOL: '1' }, 'electron.exe', undefined, 'C:d'),
    ).toBeNull();
  });
});
