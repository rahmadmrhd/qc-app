import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetOutboxChannelForTests } from './outbox-channel';
import {
  beginSending,
  beginSendingEntry,
  clearSending,
  isEntrySending,
  isItemSending,
  resetSendingForTests,
  SENDING_TTL_MS,
  sendingVersion,
  subscribeSending,
} from './outbox-status';

beforeEach(() => {
  resetOutboxChannelForTests();
  resetSendingForTests();
});
afterEach(() => vi.useRealTimers());

test('beginSending menandai butir dan end() membersihkannya', () => {
  expect(isItemSending('t', 0)).toBe(false);
  const end = beginSending('t', 0);
  expect(isItemSending('t', 0)).toBe(true);
  end();
  expect(isItemSending('t', 0)).toBe(false);
});

test('dua tanda pada butir yang sama dihitung', () => {
  const end1 = beginSending('t', 0);
  const end2 = beginSending('t', 0);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
  end1();
  expect(isItemSending('t', 0)).toBe(true);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
  end2();
  expect(isItemSending('t', 0)).toBe(false);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
});

test('end() dipanggil dua kali hanya mengurangi satu', () => {
  const end1 = beginSending('t', 0);
  const end2 = beginSending('t', 0);
  end1();
  end1();
  expect(isItemSending('t', 0)).toBe(true);
  end2();
  expect(isItemSending('t', 0)).toBe(false);
});

test('subscribeSending dipanggil saat tanda berubah dan sendingVersion naik', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSending(listener);
  const v0 = sendingVersion();
  const end = beginSending('t', 0);
  expect(listener).toHaveBeenCalledTimes(1);
  const v1 = sendingVersion();
  expect(v1).toBeGreaterThan(v0);
  end();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(sendingVersion()).toBeGreaterThan(v1);
  unsubscribe();
  beginSending('t', 1);
  expect(listener).toHaveBeenCalledTimes(2);
});

test('clearSending mengosongkan semua tanda dan memberi tahu pendengar', () => {
  const listener = vi.fn();
  subscribeSending(listener);
  beginSending('t', 0);
  beginSending('u', 3);
  listener.mockClear();
  const v0 = sendingVersion();
  clearSending();
  expect(isItemSending('t', 0)).toBe(false);
  expect(isItemSending('u', 3)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(sendingVersion()).toBeGreaterThan(v0);
});

test('end() lama sesudah clearSending tidak menghapus tanda baru', () => {
  const oldEnd = beginSending('t', 0);
  clearSending();
  const newEnd = beginSending('t', 0);
  oldEnd();
  expect(isItemSending('t', 0)).toBe(true);
  newEnd();
  expect(isItemSending('t', 0)).toBe(false);
  oldEnd();
  expect(isItemSending('t', 0)).toBe(false);
});

test('beginSendingEntry menandai entri (hitungan) dan end() idempoten membersihkannya', () => {
  expect(isEntrySending('e1')).toBe(false);
  const end1 = beginSendingEntry('e1');
  const end2 = beginSendingEntry('e1');
  expect(isEntrySending('e1')).toBe(true);
  expect(isEntrySending('e2')).toBe(false);
  end1();
  end1();
  expect(isEntrySending('e1')).toBe(true);
  end2();
  expect(isEntrySending('e1')).toBe(false);
});

test('end() entri lama sesudah clearSending tidak menghapus tanda baru; clearSending membuang tanda entri', () => {
  const oldEnd = beginSendingEntry('e1');
  clearSending();
  expect(isEntrySending('e1')).toBe(false);
  const newEnd = beginSendingEntry('e1');
  oldEnd();
  expect(isEntrySending('e1')).toBe(true);
  newEnd();
});

test('siaran: beginSendingEntry memberi tahu tab lain; selesai disiarkan sending-done', async () => {
  const other = new BroadcastChannel('qc-outbox');
  const received: unknown[] = [];
  other.onmessage = (event) => received.push(event.data);
  try {
    const end = beginSendingEntry('e1');
    await vi.waitFor(() =>
      expect(received).toContainEqual({ type: 'sending', ids: ['e1'], until: expect.any(Number) }),
    );
    end();
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'sending-done', ids: ['e1'] }));
  } finally {
    other.close();
  }
});

test('tab lain mengirim: isEntrySending benar lewat siaran, hilang oleh sending-done', async () => {
  const listener = vi.fn();
  subscribeSending(listener);
  const other = new BroadcastChannel('qc-outbox');
  try {
    other.postMessage({ type: 'sending', ids: ['e9'], until: Date.now() + SENDING_TTL_MS });
    await vi.waitFor(() => expect(isEntrySending('e9')).toBe(true));
    expect(listener).toHaveBeenCalled();
    other.postMessage({ type: 'sending-done', ids: ['e9'] });
    await vi.waitFor(() => expect(isEntrySending('e9')).toBe(false));
  } finally {
    other.close();
  }
});

test('tanda dari tab lain kedaluwarsa sendiri sesudah 45 dtk tanpa pesan lanjutan (pengirim mati)', async () => {
  const listener = vi.fn();
  subscribeSending(listener);
  const other = new BroadcastChannel('qc-outbox');
  try {
    // Pesan tiba pada jam nyata; `until` jatuh 45 dtk kemudian. Jam lalu dimajukan dengan timer palsu.
    const start = Date.now();
    other.postMessage({ type: 'sending', ids: ['e9'], until: start + SENDING_TTL_MS });
    await vi.waitFor(() => expect(isEntrySending('e9')).toBe(true));
    listener.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start + SENDING_TTL_MS + 1);
    expect(isEntrySending('e9')).toBe(false);
  } finally {
    other.close();
  }
});

test('timer kedaluwarsa memberi tahu pelanggan agar tampilan memuat ulang', async () => {
  const listener = vi.fn();
  subscribeSending(listener);
  const other = new BroadcastChannel('qc-outbox');
  try {
    other.postMessage({ type: 'sending', ids: ['e9'], until: Date.now() + 400 });
    await vi.waitFor(() => expect(isEntrySending('e9')).toBe(true));
    listener.mockClear();
    await vi.waitFor(() => expect(isEntrySending('e9')).toBe(false), { timeout: 2_000 });
    expect(listener).toHaveBeenCalled();
  } finally {
    other.close();
  }
});
