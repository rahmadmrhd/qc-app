import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import {
  onEvent,
  resetEventListenersForTest,
  type SerialStockPayload,
  statementsFor,
} from './events';

const env = {} as Env;
const payload: SerialStockPayload = {
  serialId: 's',
  eventId: 'e',
  locationId: 'l',
  picks: [],
  actor: 'a',
  now: 't',
};
const stmt = (name: string) => ({ name }) as unknown as DbStatement;
const nameOf = (statement: DbStatement) => (statement as unknown as { name: string }).name;

// `bun test` memakai satu proses untuk banyak berkas dan daftar pendengar adalah keadaan modul bersama: tes ini
// mulai dari bus kosong, lalu memulihkan pendengar stok nyata agar berkas sesudahnya (mis. `serial/act.test.ts`)
// tidak kehilangan pemotongan stok.
beforeEach(() => resetEventListenersForTest());
afterEach(() => {
  resetEventListenersForTest();
  registerSerialStockListeners();
});

describe('bus event', () => {
  test('tanpa pendengar menghasilkan daftar kosong', async () => {
    expect(await statementsFor(env, 'serial.recorded', payload)).toEqual([]);
  });

  test('pendaftaran idempoten per (jenis, fungsi); dipanggil berurutan', async () => {
    const calls: string[] = [];
    const first = () => {
      calls.push('first');
      return [stmt('a')];
    };
    const second = async () => {
      calls.push('second');
      return [stmt('b'), stmt('c')];
    };
    onEvent('serial.recorded', first);
    onEvent('serial.recorded', first);
    onEvent('serial.recorded', second);
    const result = await statementsFor(env, 'serial.recorded', payload);
    expect(calls).toEqual(['first', 'second']);
    expect(result.map(nameOf)).toEqual(['a', 'b', 'c']);
    expect(await statementsFor(env, 'serial.stickers_added', payload)).toEqual([]);
  });
});
