import { describe, expect, test } from 'bun:test';
import {
  AUTH_CHANGE_EVENT,
  BRIDGE_ARGS,
  BRIDGE_CHANNELS,
  BRIDGE_VERSION,
  DeviceRequestSchema,
  HostSchema,
  INJECT_PROGRESS_EVENT,
  InjectIdSchema,
  InjectRequestSchema,
  MIN_BRIDGE_VERSION,
  NOTIFICATIONS_BRIDGE_VERSION,
  NOTIFICATIONS_CHANGE_EVENT,
  PendingEntrySchema,
  SerialArgSchema,
  stripTerminalControl,
  UI_UPDATE_READY_EVENT,
} from './bridge-contract';
import { UI_MIN_BRIDGE_VERSION } from './ui-manifest';

const validInject = {
  id: 'run-1',
  brand: 'mikrotik',
  firmwareCode: 'AC',
  target: { ip: '192.168.88.1', username: 'admin', password: '' },
};

describe('HostSchema', () => {
  test('host hanya IPv4 atau nama host sah; "a;b" dan string kosong ditolak', () => {
    for (const ok of ['192.168.88.1', 'router.local', 'a-b.example.com']) {
      expect(HostSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      '',
      'a;b',
      '1.2.3.4 & calc',
      '-n 100 1.2.3.4',
      '999.1.1.1',
      'host name',
      'x'.repeat(254),
      '1.2.3.4\n',
    ]) {
      expect(HostSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('InjectRequestSchema', () => {
  test('InjectRequestSchema menolak id kosong dan firmwareCode kosong', () => {
    expect(InjectRequestSchema.safeParse(validInject).success).toBe(true);
    expect(InjectRequestSchema.safeParse({ ...validInject, id: '' }).success).toBe(false);
    expect(InjectRequestSchema.safeParse({ ...validInject, firmwareCode: '' }).success).toBe(false);
  });

  test('menolak id berkarakter aneh, merk tak dikenal, host tak sah, nilai kelewat panjang', () => {
    for (const patch of [
      { id: 'a b' },
      { id: '../x' },
      { id: 'x'.repeat(65) },
      { brand: 'cisco' },
      { firmwareCode: 'x'.repeat(101) },
      { target: { ...validInject.target, ip: 'a;b' } },
      { target: { ...validInject.target, username: '' } },
      { target: { ...validInject.target, username: 'u'.repeat(129) } },
      { target: { ...validInject.target, password: 'p'.repeat(257) } },
      { target: { ...validInject.target, password: 'a\nb' } },
    ]) {
      expect(InjectRequestSchema.safeParse({ ...validInject, ...patch }).success).toBe(false);
    }
  });

  test('menolak kunci tak dikenal (mis. jalur berkas atau mode dari renderer) dan bukan objek', () => {
    expect(InjectRequestSchema.safeParse({ ...validInject, scriptPath: 'C:\\x' }).success).toBe(
      false,
    );
    expect(InjectRequestSchema.safeParse(null).success).toBe(false);
    expect(InjectRequestSchema.safeParse('x').success).toBe(false);
  });

  test('kata sandi kosong diizinkan (Mikrotik admin bawaan)', () => {
    expect(InjectRequestSchema.safeParse(validInject).success).toBe(true);
  });
});

describe('DeviceRequestSchema', () => {
  const ok = { brand: 'ubiquiti', host: '10.0.0.2', username: 'ubnt', password: 'ubnt' };
  test('menerima permintaan sah dan menolak host/username kosong atau tak sah', () => {
    expect(DeviceRequestSchema.safeParse(ok).success).toBe(true);
    expect(DeviceRequestSchema.safeParse({ ...ok, host: '' }).success).toBe(false);
    expect(DeviceRequestSchema.safeParse({ ...ok, host: 'a b' }).success).toBe(false);
    expect(DeviceRequestSchema.safeParse({ ...ok, username: '' }).success).toBe(false);
    expect(DeviceRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('PendingEntrySchema dan SerialArgSchema', () => {
  const entry = {
    serial: 'AB12',
    brand: 'none',
    tipe: 'hAP',
    date: '2026-11-12',
    timestamp: '2026-11-12T08:00:00.000Z',
  };
  test('menerima entri sah; menolak serial kosong/spasi, tanggal dan waktu tak sah', () => {
    expect(PendingEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      PendingEntrySchema.safeParse({ ...entry, reinjectedAt: '2026-11-12T09:00:00+07:00' }).success,
    ).toBe(true);
    expect(PendingEntrySchema.safeParse({ ...entry, serial: '' }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, serial: '   ' }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, serial: 'a'.repeat(65) }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, date: '12/11/2026' }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, timestamp: 'kemarin' }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, brand: 'x' }).success).toBe(false);
    expect(PendingEntrySchema.safeParse({ ...entry, serial: 'A\nB' }).success).toBe(false);
  });
  test('serial argumen remove: tidak kosong, tidak berkarakter kontrol', () => {
    expect(SerialArgSchema.safeParse('AB12').success).toBe(true);
    expect(SerialArgSchema.safeParse('').success).toBe(false);
    expect(SerialArgSchema.safeParse(' ').success).toBe(false);
    expect(SerialArgSchema.safeParse('a\u0000b').success).toBe(false);
  });
  test('InjectIdSchema', () => {
    expect(InjectIdSchema.safeParse('abc-123_X').success).toBe(true);
    expect(InjectIdSchema.safeParse('a/b').success).toBe(false);
  });
});

describe('konstanta jembatan', () => {
  test('versi, dan semua nama kanal berpola qc:<grup>:<aksi> serta unik', () => {
    expect(BRIDGE_VERSION).toBe(4);
    expect(NOTIFICATIONS_BRIDGE_VERSION).toBe(4);
    expect(MIN_BRIDGE_VERSION).toBe(2);
    const values = Object.values(BRIDGE_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
    for (const channel of [
      ...values,
      INJECT_PROGRESS_EVENT,
      AUTH_CHANGE_EVENT,
      UI_UPDATE_READY_EVENT,
      NOTIFICATIONS_CHANGE_EVENT,
    ]) {
      expect(channel).toMatch(/^qc:[a-z]+:[A-Za-z]+$/);
    }
  });
});

describe('stripTerminalControl', () => {
  test('membuang urutan warna/kursor (CSI) dan menyisakan teks', () => {
    expect(stripTerminalControl('\u001b[31mgalat\u001b[0m')).toBe('galat');
    expect(stripTerminalControl('\u001b[2K\u001b[1;32mOK\u001b[m')).toBe('OK');
    expect(stripTerminalControl('\u001b[?25lx\u001b[?25h')).toBe('x');
  });
  test('membuang OSC (judul jendela) berakhir BEL maupun ESC \\ dan escape dua karakter', () => {
    expect(stripTerminalControl('\u001b]0;judul\u0007isi')).toBe('isi');
    expect(stripTerminalControl('\u001b]0;judul\u001b\\isi')).toBe('isi');
    expect(stripTerminalControl('a\u001b=b\u001b>c')).toBe('abc');
  });
  test('urutan ANSI di tengah teks tidak memecah kata (agar penyamaran sandi tetap kena)', () => {
    expect(stripTerminalControl('pa\u001b[0mss\u001b[1mword')).toBe('password');
  });
  test('membuang karakter kontrol; CR/LF/TAB menjadi satu spasi', () => {
    expect(stripTerminalControl('a\u0007b\u0008c\u0000d\u007fe\u009bf')).toBe('abcdef');
    expect(stripTerminalControl('baris1\r\nbaris2\nbaris3\rbaris4\tx')).toBe(
      'baris1 baris2 baris3 baris4 x',
    );
  });
  test('escape terpotong di ujung tidak melempar; teks biasa tak berubah', () => {
    expect(stripTerminalControl('selesai\u001b')).toBe('selesai');
    expect(stripTerminalControl('selesai\u001b[3')).toBe('selesai');
    expect(stripTerminalControl('Perangkat tidak menjawab (é ü)')).toBe(
      'Perangkat tidak menjawab (é ü)',
    );
    expect(stripTerminalControl('')).toBe('');
  });
});

describe('kanal auth (BRIDGE_VERSION 2)', () => {
  test('MIN_BRIDGE_VERSION 2 (UI memakai bridge.auth, jadi jembatan v1 ditolak); kanal auth tak menerima argumen', () => {
    expect(MIN_BRIDGE_VERSION).toBe(2);
    expect(BRIDGE_CHANNELS.authStatus).toBe('qc:auth:status');
    expect(BRIDGE_CHANNELS.authLogin).toBe('qc:auth:login');
    expect(BRIDGE_CHANNELS.authLogout).toBe('qc:auth:logout');
    for (const schema of [BRIDGE_ARGS.authStatus, BRIDGE_ARGS.authLogin, BRIDGE_ARGS.authLogout]) {
      expect(schema.safeParse([]).success).toBe(true);
      expect(schema.safeParse(['https://jahat.example']).success).toBe(false);
    }
  });
});

describe('UI_MIN_BRIDGE_VERSION', () => {
  test('tidak melebihi BRIDGE_VERSION saat ini dan paling rendah 1 (dinaikkan hanya bila UI butuh fungsi jembatan baru)', () => {
    // Bundel UI yang diunduh tak boleh meminta jembatan yang lebih rendah dari yang dibutuhkan web.
    expect(UI_MIN_BRIDGE_VERSION).toBeGreaterThanOrEqual(MIN_BRIDGE_VERSION);
    expect(UI_MIN_BRIDGE_VERSION).toBeLessThanOrEqual(BRIDGE_VERSION);
  });

  test('minimal 3: UI web memakai bridge.ui (onUpdateReady/reload, diperkenalkan di jembatan v3)', () => {
    // Bundel yang diunduh memakai `bridge.ui`; di aplikasi dengan jembatan v2 spanduk pembaruan akan error.
    expect(UI_MIN_BRIDGE_VERSION).toBeGreaterThanOrEqual(3);
  });
});
