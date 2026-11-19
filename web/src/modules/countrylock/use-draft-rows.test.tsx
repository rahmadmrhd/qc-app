import type { PendingEntry } from '@countrylock/pending';
import { SERIAL_LIMITS } from '@shared/serials';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFakeBridge } from './fake-bridge';
import type { InjectedRowInput } from './lib/injected-row';
import { AUTOSAVE_DELAY_MS, useDraftRows } from './use-draft-rows';

const input = (serial: string): InjectedRowInput => ({
  serial,
  itemId: 'item-1',
  itemLabel: 'RB-750',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
});

const savedRow = (serial: string) => ({
  clientId: `cid-${serial}-00000000`,
  serial,
  itemId: 'item-1',
  itemLabel: 'RB-750',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  testDate: '2026-11-18',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
  sample: false,
  note: '',
  capturedAt: '2026-11-18T08:00:00.000Z',
  source: 'countrylock',
  stickers: null,
  proofPhotos: [],
});

const ready = async (bridge = createFakeBridge()) => {
  const view = renderHook(() => useDraftRows(bridge));
  await waitFor(() => expect(view.result.current.status).not.toBe('loading'));
  return { bridge, ...view };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftRows', () => {
  test('memuat draft tersimpan', async () => {
    const bridge = createFakeBridge();
    bridge.draftRows.push(savedRow('AB12'));
    const { result } = await ready(bridge);
    expect(result.current.status).toBe('ready');
    expect(result.current.rows.map((row) => row.serial)).toEqual(['AB12']);
    expect(result.current.isRegistered('ab12')).toBe(true);
  });

  test('addInjected menambah baris countrylock dan menyimpannya seketika', async () => {
    const { bridge, result } = await ready();
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.addInjected(input('ab12'));
    });
    expect(outcome).toBe('added');
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ serial: 'AB12', source: 'countrylock' });
    expect(bridge.draftRows).toHaveLength(1);
    expect(bridge.draftRows[0]).toMatchObject({ serial: 'AB12' });
  });

  test('serial yang sama (termasuk varian MAC) tidak digandakan', async () => {
    const { bridge, result } = await ready();
    const outcomes: string[] = [];
    await act(async () => {
      outcomes.push(await result.current.addInjected(input('aa:bb:cc:dd:ee:ff')));
      outcomes.push(await result.current.addInjected(input('AABBCCDDEEFF')));
      outcomes.push(await result.current.addInjected(input('aabbccddeeff')));
    });
    expect(outcomes).toEqual(['added', 'duplicate', 'duplicate']);
    expect(bridge.draftRows).toHaveLength(1);
  });

  test('addInjected memakai clientId dan injectedAt dari peristiwa; clientId yang sama tidak digandakan', async () => {
    const { bridge, result } = await ready();
    const outcomes: string[] = [];
    await act(async () => {
      outcomes.push(
        await result.current.addInjected({
          ...input('ab12'),
          clientId: 'multi-evt-0001',
          injectedAt: '2026-11-18T20:30:00.000Z',
        }),
      );
      // Peristiwa dikirim ulang dengan serial berbentuk lain: tetap duplikat lewat clientId.
      outcomes.push(
        await result.current.addInjected({ ...input('zz99'), clientId: 'multi-evt-0001' }),
      );
    });
    expect(outcomes).toEqual(['added', 'duplicate']);
    expect(bridge.draftRows).toHaveLength(1);
    expect(bridge.draftRows[0]).toMatchObject({
      clientId: 'multi-evt-0001',
      serial: 'AB12',
      capturedAt: '2026-11-18T20:30:00.000Z',
      testDate: '2026-11-19',
    });
  });

  test('draft penuh: addInjected menolak dan isFull menyala', async () => {
    const bridge = createFakeBridge();
    for (let i = 0; i < SERIAL_LIMITS.tableRows; i++) bridge.draftRows.push(savedRow(`S${i}`));
    const { result } = await ready(bridge);
    expect(result.current.isFull).toBe(true);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.addInjected(input('BARU1'));
    });
    expect(outcome).toBe('full');
    expect(result.current.rows).toHaveLength(SERIAL_LIMITS.tableRows);
  });

  test('draft.load gagal: status error, tidak pernah menyimpan (termasuk lewat replace dan addInjected)', async () => {
    const save = vi.fn(async () => undefined);
    const bridge = createFakeBridge({
      draft: {
        load: async () => {
          throw new Error('Draft tersimpan rusak: isinya tidak terbaca.');
        },
        save,
      },
    });
    const { result } = await ready(bridge);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Draft tersimpan rusak');
    act(() => result.current.replace([]));
    await expect(result.current.addInjected(input('AB12'))).rejects.toThrow('Draft belum siap');
    expect(save).not.toHaveBeenCalled();
  });

  test('replace menyimpan setelah jeda; unmount memaksa simpan perubahan yang tertunda', async () => {
    const { bridge, result, unmount } = await ready();
    vi.useFakeTimers();
    const next = [{ ...savedRow('AB12'), selected: false }] as never;
    act(() => result.current.replace(next));
    expect(bridge.draftRows).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(bridge.draftRows).toHaveLength(1);

    act(() => result.current.replace([]));
    expect(bridge.draftRows).toHaveLength(1);
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.draftRows).toHaveLength(0);
  });

  test('kegagalan simpan mengisi saveFailed', async () => {
    const bridge = createFakeBridge({
      draft: {
        save: async () => {
          throw new Error('disk penuh');
        },
      },
    });
    const { result } = await ready(bridge);
    await act(async () => {
      await result.current.addInjected(input('AB12'));
    });
    expect(result.current.saveFailed).toBe(true);
    // Baris tetap ada di memori meski penyimpanan gagal.
    expect(result.current.rows).toHaveLength(1);
  });

  test('addInjected: simpan gagal = unsaved; panggilan ulang (clientId sama) menyimpan tanpa baris ganda', async () => {
    let failing = true;
    const bridge = createFakeBridge({
      draft: {
        save: async (rows) => {
          if (failing) throw new Error('disk penuh');
          bridge.draftRows.splice(0, bridge.draftRows.length, ...structuredClone([...rows]));
        },
      },
    });
    const { result } = await ready(bridge);
    const evt = { ...input('AB12'), clientId: 'multi-evt-0001' };
    let first: string | undefined;
    await act(async () => {
      first = await result.current.addInjected(evt);
    });
    expect(first).toBe('unsaved');
    expect(bridge.draftRows).toHaveLength(0);

    failing = false;
    let second: string | undefined;
    await act(async () => {
      second = await result.current.addInjected(evt);
    });
    expect(second).toBe('duplicate');
    expect(result.current.rows).toHaveLength(1);
    expect(bridge.draftRows).toHaveLength(1);

    let third: string | undefined;
    await act(async () => {
      third = await result.current.addInjected(evt);
    });
    expect(third).toBe('duplicate');
  });

  describe('migrasi pending', () => {
    const pending = (serial: string, extra: Partial<PendingEntry> = {}): PendingEntry => ({
      serial,
      brand: 'mikrotik',
      tipe: 'RB-750',
      date: '2026-11-17',
      timestamp: '2026-11-17T08:00:00.000Z',
      buId: 'bu-1',
      buLabel: 'DEF - BU',
      locationId: 'loc-1',
      locationLabel: 'QC-A - QC',
      itemId: 'item-1',
      clientId: `cid-${serial}-00000000`,
      ...extra,
    });

    test('memindahkan pending lama ke draft lalu menghapusnya dari pending', async () => {
      const bridge = createFakeBridge();
      bridge.pendingList.push(pending('AA11'), pending('OLD1', { itemId: undefined }));
      const { result } = await ready(bridge);
      expect(result.current.rows.map((row) => row.serial)).toEqual(['AA11', 'OLD1']);
      expect(result.current.rows[1]?.unresolved).toEqual(['item']);
      await waitFor(() => expect(bridge.pendingList).toHaveLength(0));
      expect(bridge.draftRows).toHaveLength(2);
    });

    test('pending.remove gagal: tidak menggandakan baris pada muat berikutnya', async () => {
      const bridge = createFakeBridge({
        pending: {
          remove: async () => {
            throw new Error('gagal');
          },
        },
      });
      bridge.pendingList.push(pending('AA11'));
      const first = await ready(bridge);
      await waitFor(() => expect(bridge.draftRows).toHaveLength(1));
      first.unmount();
      const second = await ready(bridge);
      expect(second.result.current.rows).toHaveLength(1);
    });

    test('draft gagal disimpan: pending tidak dihapus', async () => {
      const bridge = createFakeBridge({
        draft: {
          save: async () => {
            throw new Error('disk penuh');
          },
        },
      });
      bridge.pendingList.push(pending('AA11'));
      const { result } = await ready(bridge);
      await waitFor(() => expect(result.current.saveFailed).toBe(true));
      expect(bridge.pendingList).toHaveLength(1);
    });
  });
});
