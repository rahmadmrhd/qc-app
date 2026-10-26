import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { logRequest } from './log';

const real = { log: console.log, warn: console.warn, error: console.error };
let calls: { level: 'log' | 'warn' | 'error'; value: unknown }[];

beforeEach(() => {
  calls = [];
  console.log = (value?: unknown) => void calls.push({ level: 'log', value });
  console.warn = (value?: unknown) => void calls.push({ level: 'warn', value });
  console.error = (value?: unknown) => void calls.push({ level: 'error', value });
});

afterEach(() => {
  console.log = real.log;
  console.warn = real.warn;
  console.error = real.error;
});

describe('logRequest', () => {
  test('sukses = console.log berupa OBJEK (bukan string) agar field terindeks', () => {
    logRequest({
      evt: 'rpc',
      requestId: 'ab12cd34',
      method: 'items.list',
      ok: true,
      ms: 12,
      userId: 'u1',
    });
    expect(calls).toEqual([
      {
        level: 'log',
        value: {
          evt: 'rpc',
          requestId: 'ab12cd34',
          method: 'items.list',
          ok: true,
          ms: 12,
          userId: 'u1',
        },
      },
    ]);
  });

  test('galat yang wajar (izin, validasi, kuota) = warn; galat tak terduga = error', () => {
    for (const code of [
      'VALIDATION',
      'FORBIDDEN',
      'UNAUTHENTICATED',
      'NOT_FOUND',
      'CONFLICT',
      'UNAVAILABLE',
    ]) {
      logRequest({ evt: 'rpc', requestId: 'r', method: 'm', ok: false, code, ms: 1 });
    }
    logRequest({ evt: 'sync', requestId: 'r', method: 'm', ok: false, code: 'INTERNAL', ms: 1 });
    expect(calls.map((c) => c.level)).toEqual([
      'warn',
      'warn',
      'warn',
      'warn',
      'warn',
      'warn',
      'error',
    ]);
  });

  test('tidak memuat email, token, atau isi payload', () => {
    logRequest({
      evt: 'rpc',
      requestId: 'r',
      method: 'handovers.save',
      ok: true,
      ms: 3,
      userId: 'u1',
    });
    expect(Object.keys(calls[0]?.value as object).sort()).toEqual([
      'evt',
      'method',
      'ms',
      'ok',
      'requestId',
      'userId',
    ]);
  });
});
