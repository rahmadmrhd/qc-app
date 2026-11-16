import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { handoffUrl, openInDesktop } from './handoff';

const original = window.location;
let assigned = '';

beforeEach(() => {
  assigned = '';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      set href(value: string) {
        assigned = value;
      },
      get href() {
        return assigned;
      },
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original });
  vi.clearAllMocks();
});

test('handoffUrl: tiket dan email di-encode, hanya dua parameter', () => {
  expect(handoffUrl('aaa.bbb', 'rina+x@qc.local')).toBe(
    'qc://country-lock?handoff=aaa.bbb&as=rina%2Bx%40qc.local',
  );
});

test('openInDesktop meminta tiket lalu mengarahkan ke tautan qc://', async () => {
  apiMock.mockResolvedValue({ ticket: 'abc.def', email: 'rina@qc.local' });
  await openInDesktop();
  expect(apiMock).toHaveBeenCalledWith('desktop.handoff', {});
  expect(assigned).toBe('qc://country-lock?handoff=abc.def&as=rina%40qc.local');
});

test('galat permintaan tiket diteruskan dan tidak membuka apa pun', async () => {
  apiMock.mockRejectedValue(new Error('gagal'));
  await expect(openInDesktop()).rejects.toThrow('gagal');
  expect(assigned).toBe('');
});
