import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';
import { refreshOutboxFromStore } from '@/modules/handover/lib/outbox';
import { handoverKeys } from '@/modules/handover/queries';
import { startOutboxSwBridge } from './outbox-sw-bridge';

type Listener = (event: { data: unknown }) => void;

function fakeSw() {
  const listeners = new Set<Listener>();
  return {
    addEventListener: vi.fn((_type: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: Listener) => listeners.delete(listener)),
    emit: (data: unknown) => {
      for (const listener of [...listeners]) listener({ data });
    },
    size: () => listeners.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const valid = { type: 'qc-outbox-synced', taskIds: ['t1'], created: false, rejected: 0 };

vi.mock('@/modules/handover/lib/outbox', () => ({ refreshOutboxFromStore: vi.fn() }));
const refresh = vi.mocked(refreshOutboxFromStore);

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;
let onSynced: Mock<() => void>;

beforeEach(() => {
  client = new QueryClient();
  invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  refresh.mockReset();
  refresh.mockResolvedValue([]);
  onSynced = vi.fn<() => void>();
});

function start(sw = fakeSw()) {
  const stop = startOutboxSwBridge({
    queryClient: client,
    owner: 'a@x.com',
    onSynced,
    sw: sw as never,
  });
  return { sw, stop };
}

describe('startOutboxSwBridge', () => {
  test('pesan valid: tandai Serah Terima basi, audit basi, baca ulang toko, lalu onSynced', async () => {
    const { sw } = start();
    sw.emit(valid);
    await settle();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: handoverKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.audit, refetchType: 'none' });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: customerKeys.all,
      refetchType: 'none',
    });
    expect(refresh).toHaveBeenCalledWith('a@x.com');
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(refresh.mock.invocationCallOrder[0] as number).toBeLessThan(
      onSynced.mock.invocationCallOrder[0] as number,
    );
  });

  test('created: customer dan opsi Serah Terima ikut ditandai basi', async () => {
    const { sw } = start();
    sw.emit({ ...valid, taskIds: [], created: true });
    await settle();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customerKeys.all, refetchType: 'none' });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['handovers', 'options'],
      refetchType: 'none',
    });
  });

  test('hanya rejected: tetap memicu penguras (mengumumkan entri rejected)', async () => {
    const { sw } = start();
    sw.emit({ ...valid, taskIds: [], rejected: 2 });
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['tipe lain', { ...valid, type: 'lain' }],
    ['null', null],
    ['string', 'qc-outbox-synced'],
    ['taskIds bukan larik', { ...valid, taskIds: 'x' }],
    ['taskIds berisi bukan string', { ...valid, taskIds: [1] }],
    ['created bukan boolean', { ...valid, created: 'ya' }],
    ['rejected bukan angka', { ...valid, rejected: '1' }],
    ['rejected tak hingga', { ...valid, rejected: Number.POSITIVE_INFINITY }],
    ['tanpa field', { type: 'qc-outbox-synced' }],
  ])('pesan salah bentuk diabaikan: %s', async (_name, data) => {
    const { sw } = start();
    sw.emit(data);
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
  });

  test('refresh yang menolak tidak menggagalkan onSynced', async () => {
    refresh.mockRejectedValue(new Error('idb'));
    const { sw } = start();
    sw.emit(valid);
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test('fungsi berhenti melepas pendengar; pesan sesudahnya diabaikan', async () => {
    const { sw, stop } = start();
    expect(sw.size()).toBe(1);
    expect(sw.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    stop();
    expect(sw.size()).toBe(0);
    expect(sw.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    sw.emit(valid);
    await settle();
    expect(onSynced).not.toHaveBeenCalled();
  });

  test('tanpa serviceWorker: tak berbuat apa pun dan berhenti aman', () => {
    const stop = startOutboxSwBridge({
      queryClient: client,
      owner: 'a@x.com',
      onSynced,
      sw: null as never,
    });
    expect(() => stop()).not.toThrow();
  });
});
