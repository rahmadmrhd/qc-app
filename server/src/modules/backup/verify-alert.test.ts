import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Env } from '@server/core/env';
import type { Mailer, MailMessage } from '@server/core/mail';
import { getSetting, putSetting } from '@server/core/settings';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { ALERT_MIN_INTERVAL_MS } from './alert';
import { backupName } from './names';
import {
  checkBackupVerifyAlerts,
  SETTING_VERIFY_FAILED_ALERT_AT,
  SETTING_VERIFY_MISSING_ALERT_AT,
} from './verify-alert';
import {
  SETTING_BACKUP_LAST_SUCCESS_NAME,
  type StoredVerifyResult,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_MISSING_AFTER_MS,
  writeVerifyResult,
} from './verify-state';

const HOUR = 60 * 60 * 1000;

let env: TestEnv;
let sent: MailMessage[];
let name: string;

const mailer: Mailer = {
  async send(message) {
    sent.push(message);
  },
};

async function makeEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  return createTestEnv({
    BACKUP_ENABLED: true,
    MAILER: mailer,
    ALERT_TO: ['pemilik@example.test'],
    BACKUP_VERIFY: async () => {
      throw new Error('tak dipakai di tes ini');
    },
    ...overrides,
  });
}

const stored = (patch: Partial<StoredVerifyResult> = {}): StoredVerifyResult => ({
  status: 'ok',
  name,
  attempts: 1,
  startedAt: env.clock.now(),
  finishedAt: env.clock.now(),
  durationMs: 1000,
  summary: 'ringkasan',
  failures: [],
  notes: [],
  tables: 1,
  rows: 1,
  bytes: 1,
  ...patch,
});

beforeEach(async () => {
  sent = [];
  env = await makeEnv();
  // Cadangan terakhir berhasil 13 jam lalu (lewat batas "tidak berjalan").
  name = backupName(env.clock.now() - 13 * HOUR);
  await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, name);
});

afterEach(() => {
  spyOn(console, 'warn').mockRestore();
});

describe('peringatan verifikasi cadangan', () => {
  test('hasil ok -> tidak ada email', async () => {
    await writeVerifyResult(env, stored());
    expect(await checkBackupVerifyAlerts(env)).toEqual({ failed: 'ok', missing: 'ok' });
    expect(sent).toEqual([]);
  });

  test('hasil failed -> satu email berisi rincian, dibatasi sekali per 12 jam, kirim lagi sesudahnya', async () => {
    await writeVerifyResult(
      env,
      stored({
        status: 'failed',
        summary: 'Pemulihan tidak sama',
        failures: ['settings: dump 2 baris, hasil pemulihan 1 baris'],
      }),
    );
    expect((await checkBackupVerifyAlerts(env)).failed).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['pemilik@example.test']);
    expect(sent[0]?.subject).toContain('uji pemulihan');
    expect(sent[0]?.text).toContain(name);
    expect(sent[0]?.text).toContain('settings: dump 2 baris');
    expect((await checkBackupVerifyAlerts(env)).failed).toBe('throttled');
    expect(sent).toHaveLength(1);
    env.clock.advance(ALERT_MIN_INTERVAL_MS + 1);
    expect((await checkBackupVerifyAlerts(env)).failed).toBe('sent');
  });

  test('error dengan sisa percobaan -> belum failed; semua percobaan habis -> failed', async () => {
    await writeVerifyResult(env, stored({ status: 'error', attempts: 1 }));
    expect((await checkBackupVerifyAlerts(env)).failed).toBe('ok');
    await writeVerifyResult(env, stored({ status: 'error', attempts: VERIFY_MAX_ATTEMPTS }));
    expect((await checkBackupVerifyAlerts(env)).failed).toBe('sent');
    expect(sent.some((mail) => mail.text.includes('tidak dapat diselesaikan'))).toBe(true);
  });

  test('tanpa hasil sama sekali lebih dari 12 jam sesudah cadangan -> peringatan "belum diverifikasi"', async () => {
    const outcome = await checkBackupVerifyAlerts(env);
    expect(outcome.missing).toBe('sent');
    expect(sent[0]?.subject).toContain('belum diverifikasi');
    expect(sent[0]?.text).toContain('Tidak ada hasil verifikasi');
    expect((await checkBackupVerifyAlerts(env)).missing).toBe('throttled');
    expect(Number(await getSetting(env, SETTING_VERIFY_MISSING_ALERT_AT))).toBe(env.clock.now());
  });

  test('verifikasi belum dikonfigurasi (BACKUP_VERIFY kosong) -> pesan menyebut RESTORE_DATABASE_URL', async () => {
    const unconfigured = await makeEnv({ BACKUP_VERIFY: undefined });
    await putSetting(unconfigured, SETTING_BACKUP_LAST_SUCCESS_NAME, name);
    expect((await checkBackupVerifyAlerts(unconfigured)).missing).toBe('sent');
    expect(sent[0]?.text).toContain('RESTORE_DATABASE_URL');
  });

  test('cadangan masih baru (di bawah 12 jam) atau hasil milik cadangan sebelumnya yang ok -> belum ada peringatan', async () => {
    const fresh = backupName(env.clock.now() - VERIFY_MISSING_AFTER_MS + HOUR);
    await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, fresh);
    expect(await checkBackupVerifyAlerts(env)).toEqual({ failed: 'ok', missing: 'ok' });
    expect(sent).toEqual([]);
  });

  test('hasil failed milik cadangan LAMA tidak membunyikan peringatan cadangan baru yang belum tua', async () => {
    const older = backupName(env.clock.now() - 40 * HOUR);
    await writeVerifyResult(env, stored({ status: 'failed', name: older }));
    const fresh = backupName(env.clock.now() - HOUR);
    await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, fresh);
    expect(await checkBackupVerifyAlerts(env)).toEqual({ failed: 'ok', missing: 'ok' });
    expect(sent).toEqual([]);
    expect(await getSetting(env, SETTING_VERIFY_FAILED_ALERT_AT)).toBe('');
  });

  test('cadangan tidak diaktifkan atau SMTP/penerima kosong -> dilewati, tidak melempar', async () => {
    const off = await makeEnv({ BACKUP_ENABLED: false });
    expect(await checkBackupVerifyAlerts(off)).toEqual({ failed: 'skipped', missing: 'skipped' });
    const noMailer = await makeEnv({ MAILER: undefined });
    spyOn(console, 'warn').mockImplementation(() => {});
    expect(await checkBackupVerifyAlerts(noMailer)).toEqual({
      failed: 'skipped',
      missing: 'skipped',
    });
    const noTo = await makeEnv({ ALERT_TO: [] });
    expect(await checkBackupVerifyAlerts(noTo)).toEqual({ failed: 'skipped', missing: 'skipped' });
    expect(sent).toEqual([]);
  });

  test('belum ada cadangan berhasil tercatat -> tidak ada peringatan verifikasi', async () => {
    await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, '');
    expect(await checkBackupVerifyAlerts(env)).toEqual({ failed: 'ok', missing: 'ok' });
  });
});
