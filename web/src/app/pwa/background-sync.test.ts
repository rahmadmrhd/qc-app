import { describe, expect, test, vi } from 'vitest';
import { BACKGROUND_SYNC_TAG, registerBackgroundSync } from './background-sync';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('registerBackgroundSync', () => {
  test('tag sama dengan tag di sync-sw.js', () => {
    expect(BACKGROUND_SYNC_TAG).toBe('qc-outbox');
  });

  test('tanpa SyncManager tidak berbuat apa pun', async () => {
    const register = vi.fn();
    const ready = Promise.resolve({ sync: { register } });
    registerBackgroundSync({ sw: { ready } as never, hasSyncManager: () => false });
    await flush();
    expect(register).not.toHaveBeenCalled();
  });

  test('dengan SyncManager mendaftarkan tag qc-outbox pada registrasi yang siap', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const ready = Promise.resolve({ sync: { register } });
    registerBackgroundSync({ sw: { ready } as never, hasSyncManager: () => true });
    await flush();
    expect(register).toHaveBeenCalledWith('qc-outbox');
  });

  test('registrasi tanpa sync (tak didukung) tidak melempar', async () => {
    registerBackgroundSync({
      sw: { ready: Promise.resolve({}) } as never,
      hasSyncManager: () => true,
    });
    await flush();
  });

  test('ready yang tak pernah selesai tidak menggantung atau melempar pemanggil', () => {
    const ready = new Promise<never>(() => undefined);
    expect(() =>
      registerBackgroundSync({ sw: { ready } as never, hasSyncManager: () => true }),
    ).not.toThrow();
  });

  test('register yang menolak, ready yang menolak, atau akses yang melempar tidak menimbulkan galat', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      registerBackgroundSync({
        sw: {
          ready: Promise.resolve({ sync: { register: () => Promise.reject(new Error('x')) } }),
        } as never,
        hasSyncManager: () => true,
      });
      registerBackgroundSync({
        sw: { ready: Promise.reject(new Error('y')) } as never,
        hasSyncManager: () => true,
      });
      expect(() =>
        registerBackgroundSync({
          sw: {
            get ready(): Promise<never> {
              throw new Error('z');
            },
          } as never,
          hasSyncManager: () => true,
        }),
      ).not.toThrow();
      await flush();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('tanpa deps: di lingkungan tes tidak melempar', () => {
    expect(() => registerBackgroundSync()).not.toThrow();
  });
});
