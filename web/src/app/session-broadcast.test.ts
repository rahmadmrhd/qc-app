import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as deviceDb from '@/lib/device-db';
import { ANONYMOUS_SESSION, initSession } from '@/modules/auth/session';
import { makeHandover } from '@/modules/handover/components/test-handover';
import { boardColumnData } from '@/modules/handover/lib/board-cache';
import { enqueueOutbox, readOutbox, resumeOutboxWrites } from '@/modules/handover/lib/outbox';
import { handoverKeys } from '@/modules/handover/queries';
import { resetOutboxEnv } from '@/test/outbox-env';
import { resetBoardPersistForTests, startBoardPersistence } from './board-persist';
import {
  announceLogout,
  handleRemoteLogout,
  resetSessionBroadcastForTests,
  startSessionListener,
} from './session-broadcast';

const OWNER = 'a@x.com';
const check = {
  kind: 'check' as const,
  taskId: 't1',
  locationId: 'loc-a',
  index: 0,
  text: 'A = 1',
  checked: true,
  at: Date.now(),
};

beforeEach(() => {
  resetOutboxEnv();
  resetBoardPersistForTests();
  resetSessionBroadcastForTests();
  initSession({ ...ANONYMOUS_SESSION, authenticated: true, email: OWNER });
});
afterEach(() => {
  resumeOutboxWrites();
  resetSessionBroadcastForTests();
  initSession(ANONYMOUS_SESSION);
  vi.restoreAllMocks();
});

/** Tab lain: instans kanal terpisah (instans yang sama tidak menerima pesannya sendiri). */
function otherTab() {
  const channel = new BroadcastChannel('qc-session');
  const received: unknown[] = [];
  channel.onmessage = (event) => received.push(event.data);
  return { channel, received };
}

test('announceLogout menyiarkan pemilik ke tab lain', async () => {
  const { channel, received } = otherTab();
  try {
    announceLogout(OWNER);
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'logout', owner: OWNER }));
  } finally {
    channel.close();
  }
});

test('startSessionListener menerima siaran tab lain; fungsi stop melepas pendengar', async () => {
  const onLogout = vi.fn();
  const stop = startSessionListener(onLogout);
  const { channel } = otherTab();
  try {
    channel.postMessage({ type: 'logout', owner: OWNER });
    await vi.waitFor(() => expect(onLogout).toHaveBeenCalledWith(OWNER));
    channel.postMessage({ type: 'aneh' });
    channel.postMessage('bukan objek');
    channel.postMessage({ type: 'logout', owner: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onLogout).toHaveBeenCalledTimes(1);
    stop();
    channel.postMessage({ type: 'logout', owner: OWNER });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onLogout).toHaveBeenCalledTimes(1);
  } finally {
    channel.close();
  }
});

test('tab pengirim tidak menerima siarannya sendiri', async () => {
  const onLogout = vi.fn();
  const stop = startSessionListener(onLogout);
  announceLogout(OWNER);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(onLogout).not.toHaveBeenCalled();
  stop();
});

test('tanpa BroadcastChannel tidak galat dan tidak berbuat apa pun', () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  try {
    expect(() => announceLogout(OWNER)).not.toThrow();
    const stop = startSessionListener(vi.fn());
    expect(() => stop()).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('pesan logout pemilik sama: penulisan antrean ditahan, salinan dikosongkan, penyimpan papan berhenti', async () => {
  await enqueueOutbox(OWNER, check);
  expect(readOutbox(OWNER)).toHaveLength(1);
  const client = new QueryClient();
  const board = startBoardPersistence(client);
  const stopBoard = vi.spyOn(board, 'stop');
  const fetchColumn = (status: 'new' | 'done') =>
    client.fetchQuery({
      queryKey: handoverKeys.column(['loc-a'], status),
      queryFn: async () => boardColumnData([makeHandover()]),
      staleTime: 0,
    });
  // Kontrol: sebelum tab lain keluar, sukses query ditulis ke IndexedDB.
  await fetchColumn('new');
  await board.flush();
  expect(await deviceDb.readAllRecords('columns')).toHaveLength(1);
  await deviceDb.clearBoardStores();

  handleRemoteLogout(OWNER, { currentOwner: OWNER, stopBoardPersistence: () => board.stop() });
  expect(stopBoard).toHaveBeenCalledTimes(1);
  // Antrean: salinan kosong dan penulisan berikutnya ditolak.
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await enqueueOutbox(OWNER, { ...check, index: 1, text: 'B = 2' })).toBe('failed');
  // Papan: sukses query sesudahnya tidak ditulis lagi.
  await fetchColumn('done');
  await board.flush();
  expect(await deviceDb.readAllRecords('columns')).toEqual([]);
});

test('pesan logout pemilik lain diabaikan', async () => {
  await enqueueOutbox(OWNER, check);
  const stopBoard = vi.fn();
  handleRemoteLogout('lain@x.com', { currentOwner: OWNER, stopBoardPersistence: stopBoard });
  expect(stopBoard).not.toHaveBeenCalled();
  expect(readOutbox(OWNER)).toHaveLength(1);
  expect(await enqueueOutbox(OWNER, { ...check, index: 1, text: 'B = 2' })).toBe('ok');
});
