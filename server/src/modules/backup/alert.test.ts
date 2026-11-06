import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Env } from '@server/core/env';
import { createSmtpMailer, type Mailer, type MailMessage } from '@server/core/mail';
import { getSetting } from '@server/core/settings';
import { startScheduler } from '@server/jobs/runner';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  ALERT_MIN_INTERVAL_MS,
  BACKUP_STALE_MS,
  checkBackupAlerts,
  SETTING_BACKUP_ALERT_AT,
  SETTING_QUOTA_ALERT_AT,
} from './alert';
import { backupName } from './names';
import { ensureBackupFolder } from './upload';

const HOUR = 60 * 60 * 1000;
const GIB = 1024 ** 3;
const SENTINEL = 'SANDI-SMTP-SENTINEL-55b';

let env: TestEnv;
let sent: MailMessage[];
let sendBehavior: (message: MailMessage) => Promise<void>;

const mailer: Mailer = {
  async send(message) {
    await sendBehavior(message);
    sent.push(message);
  },
};

async function seedBackup(ageMs: number): Promise<void> {
  const folderId = await ensureBackupFolder(env);
  await env.BRIDGE.uploadFile(
    folderId,
    backupName(env.clock.now() - ageMs),
    'application/gzip',
    new TextEncoder().encode('x'),
  );
}

async function makeEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  return createTestEnv({
    BACKUP_ENABLED: true,
    MAILER: mailer,
    ALERT_TO: ['pemilik@example.test'],
    ...overrides,
  });
}

beforeEach(async () => {
  sent = [];
  sendBehavior = async () => {};
  env = await makeEnv();
});

afterEach(() => {
  spyOn(console, 'error').mockRestore();
  spyOn(console, 'warn').mockRestore();
});

describe('peringatan cadangan basi', () => {
  test('cadangan terbaru 40 jam -> satu email ke ALERT_TO, waktu terakhir tersimpan', async () => {
    await seedBackup(40 * HOUR);
    const outcome = await checkBackupAlerts(env);
    expect(outcome.backup).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['pemilik@example.test']);
    expect(sent[0]?.subject).toContain('cadangan');
    expect(sent[0]?.text).toContain('40 jam');
    expect(await getSetting(env, SETTING_BACKUP_ALERT_AT)).toBe(String(env.clock.now()));
  });

  test('cadangan terbaru 10 jam -> tidak ada email', async () => {
    await seedBackup(10 * HOUR);
    expect((await checkBackupAlerts(env)).backup).toBe('ok');
    expect(sent).toEqual([]);
  });

  test('batas: tepat 36 jam belum basi; sedikit di atasnya basi', async () => {
    await seedBackup(BACKUP_STALE_MS - 60_000); // nama hanya sampai menit
    expect((await checkBackupAlerts(env)).backup).toBe('ok');
    env = await makeEnv();
    await seedBackup(BACKUP_STALE_MS + 2 * 60_000);
    expect((await checkBackupAlerts(env)).backup).toBe('sent');
  });

  test('dua pemeriksaan dalam 12 jam -> satu email', async () => {
    await seedBackup(40 * HOUR);
    await checkBackupAlerts(env);
    env.clock.advance(6 * HOUR);
    expect((await checkBackupAlerts(env)).backup).toBe('throttled');
    expect(sent).toHaveLength(1);
  });

  test('13 jam sesudah peringatan pertama dan masih basi -> email kedua', async () => {
    await seedBackup(40 * HOUR);
    await checkBackupAlerts(env);
    env.clock.advance(ALERT_MIN_INTERVAL_MS + HOUR);
    expect((await checkBackupAlerts(env)).backup).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  test('cadangan terbaru ditentukan dari nama (bukan urutan daftar); yang segar membatalkan peringatan', async () => {
    await seedBackup(100 * HOUR);
    await seedBackup(5 * HOUR);
    expect((await checkBackupAlerts(env)).backup).toBe('ok');
  });

  test('tidak ada folder cadangan/salinan sama sekali -> dianggap basi', async () => {
    const outcome = await checkBackupAlerts(env);
    expect(outcome.backup).toBe('sent');
    expect(sent[0]?.text).toContain('Belum ada satu pun cadangan');
  });

  test('berkas bernama tak dikenal tidak dihitung sebagai cadangan', async () => {
    const folderId = await ensureBackupFolder(env);
    await env.BRIDGE.uploadFile(
      folderId,
      'catatan.txt',
      'text/plain',
      new TextEncoder().encode('x'),
    );
    expect((await checkBackupAlerts(env)).backup).toBe('sent');
  });

  test('email gagal terkirim -> dicatat, tidak melempar, waktu terakhir TIDAK disimpan; dicoba lagi pada pemeriksaan berikutnya', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    await seedBackup(40 * HOUR);
    sendBehavior = async () => {
      throw new Error('Pengiriman email gagal: koneksi ditolak');
    };
    const first = await checkBackupAlerts(env);
    expect(first.backup).toBe('failed');
    expect(await getSetting(env, SETTING_BACKUP_ALERT_AT)).toBe('');
    expect(errors).toHaveBeenCalled();
    sendBehavior = async () => {};
    env.clock.advance(HOUR);
    expect((await checkBackupAlerts(env)).backup).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('galat membaca Drive dilempar (tercatat oleh penjadwal) setelah pemeriksaan kuota tetap dicoba', async () => {
    await seedBackup(HOUR); // folder cadangan ada
    env.BRIDGE.failNext('listFolder', new Error('Drive down'));
    spyOn(console, 'error').mockImplementation(() => {});
    env.BRIDGE.state.quota = { limit: 15 * GIB, usage: 14 * GIB };
    await expect(checkBackupAlerts(env)).rejects.toThrow();
    expect(sent.filter((message) => message.subject.includes('kuota'))).toHaveLength(1);
  });

  test('BACKUP_ENABLED tidak diset -> tidak melakukan apa pun', async () => {
    const plain = await createTestEnv({ MAILER: mailer, ALERT_TO: ['a@example.test'] });
    expect(await checkBackupAlerts(plain)).toEqual({ backup: 'skipped', quota: 'skipped' });
    expect(sent).toEqual([]);
  });

  test('tanpa MAILER atau ALERT_TO: dilewati tanpa melempar dan tanpa menyentuh Drive', async () => {
    spyOn(console, 'warn').mockImplementation(() => {});
    const noMailer = await makeEnv({ MAILER: undefined });
    expect(await checkBackupAlerts(noMailer)).toEqual({ backup: 'skipped', quota: 'skipped' });
    const noTo = await makeEnv({ ALERT_TO: [] });
    expect(await checkBackupAlerts(noTo)).toEqual({ backup: 'skipped', quota: 'skipped' });
    expect(noMailer.BRIDGE.calls).toEqual([]);
  });
});

describe('peringatan kuota Drive', () => {
  beforeEach(async () => {
    await seedBackup(HOUR); // cadangan segar: hanya kuota yang diuji
  });

  test('di atas ambang bawaan 80% -> email; throttle terpisah dari peringatan cadangan', async () => {
    env.BRIDGE.state.quota = { limit: 15 * GIB, usage: 13 * GIB }; // 86,7%
    const outcome = await checkBackupAlerts(env);
    expect(outcome).toEqual({ backup: 'ok', quota: 'sent' });
    expect(sent[0]?.subject).toContain('kuota');
    expect(sent[0]?.text).toContain('86.7%');
    expect(await getSetting(env, SETTING_QUOTA_ALERT_AT)).toBe(String(env.clock.now()));
    expect((await checkBackupAlerts(env)).quota).toBe('throttled');
  });

  test('di bawah ambang -> tidak ada email; ambang dapat diatur', async () => {
    env.BRIDGE.state.quota = { limit: 15 * GIB, usage: 11 * GIB }; // 73,3%
    expect((await checkBackupAlerts(env)).quota).toBe('ok');
    const strict = await makeEnv({ QUOTA_ALERT_PERCENT: 70 });
    await seedBackupIn(strict);
    strict.BRIDGE.state.quota = { limit: 15 * GIB, usage: 11 * GIB };
    expect((await checkBackupAlerts(strict)).quota).toBe('sent');
  });

  test('kuota tak terbatas (limit null) -> dilewati', async () => {
    env.BRIDGE.state.quota = { limit: null, usage: 999 * GIB };
    expect((await checkBackupAlerts(env)).quota).toBe('ok');
    expect(sent).toEqual([]);
  });

  test('cadangan basi DAN kuota penuh -> dua email terpisah', async () => {
    env = await makeEnv();
    await seedBackup(50 * HOUR);
    env.BRIDGE.state.quota = { limit: 15 * GIB, usage: 15 * GIB };
    const outcome = await checkBackupAlerts(env);
    expect(outcome).toEqual({ backup: 'sent', quota: 'sent' });
    expect(sent.map((message) => message.subject).sort()).toHaveLength(2);
  });
});

async function seedBackupIn(target: TestEnv): Promise<void> {
  await target.BRIDGE.uploadFile(
    await ensureBackupFolder(target),
    backupName(target.clock.now() - HOUR),
    'application/gzip',
    new TextEncoder().encode('x'),
  );
}

describe('rahasia SMTP', () => {
  test('pesan email dan log tidak memuat SMTP_PASS, termasuk saat transport gagal dengan kata sandi di pesan galatnya', async () => {
    const logs: string[] = [];
    for (const method of ['error', 'warn', 'log'] as const) {
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const transported: Array<{ subject: string; text: string }> = [];
    let fail = true;
    const smtpMailer = createSmtpMailer(
      {
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        user: 'qc@example.test',
        pass: SENTINEL,
        from: 'qc@example.test',
      },
      {
        createTransport: () => ({
          async sendMail(message) {
            transported.push(message);
            if (fail) throw new Error(`535 auth gagal untuk qc@example.test dengan ${SENTINEL}`);
          },
        }),
      },
    );
    const secretEnv = await makeEnv({ MAILER: smtpMailer });
    await seedBackup(40 * HOUR);
    expect((await checkBackupAlerts(secretEnv)).backup).toBe('failed');
    fail = false;
    secretEnv.clock.advance(HOUR);
    expect((await checkBackupAlerts(secretEnv)).backup).toBe('sent');
    const everything = JSON.stringify(transported) + logs.join('\n');
    expect(everything).not.toContain(SENTINEL);
    expect(transported.length).toBe(2);
  });
});

describe('penjadwal', () => {
  test('stop() menunggu pemeriksaan peringatan yang sedang berjalan selesai', async () => {
    await seedBackup(40 * HOUR);
    let started = false;
    let finished = false;
    sendBehavior = async () => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 200));
      finished = true;
    };
    const stop = startScheduler(env, { intervalMs: 10_000 });
    const deadline = Date.now() + 5000;
    while (!started && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(true);
    expect(finished).toBe(false);
    await stop();
    expect(finished).toBe(true);
  });
});
