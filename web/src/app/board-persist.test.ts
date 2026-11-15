import 'fake-indexeddb/auto';
import type { BoardPageDto, HandoverDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as deviceDb from '@/lib/device-db';
import { type DeviceRecord, readAllRecords, resetDeviceDbForTests } from '@/lib/device-db';
import { ANONYMOUS_SESSION, clearSession, initSession } from '@/modules/auth/session';
import type { BoardColumnData } from '@/modules/handover/lib/board-cache';
import { handoverKeys } from '@/modules/handover/queries';
import {
  BOARD_STORE_VERSION,
  clearBoardStore,
  resetBoardPersistForTests,
  restoreBoardCache,
  startBoardPersistence,
} from './board-persist';

// Pembungkus tipis atas modul nyata agar panggilan dapat dipantau dan `readAllRecords` dapat diperlambat.
vi.mock('@/lib/device-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/device-db')>();
  return {
    ...actual,
    readAllRecords: vi.fn(actual.readAllRecords),
    writeRecords: vi.fn(actual.writeRecords),
  };
});

const OWNER = 'a@x.id';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function dto(id: string): HandoverDto {
  return { id, locationId: 'l1', checklist: [], comments: [] } as unknown as HandoverDto;
}
function page(n: number, prefix: string, nextCursor: string | null): BoardPageDto {
  return {
    items: Array.from({ length: n }, (_, i) => dto(`${prefix}${i}`)),
    nextCursor,
    total: 99,
  };
}
function columnData(n = 2): BoardColumnData {
  return { pages: [page(n, 'a', null)], pageParams: [undefined] };
}

let client: QueryClient;
let persistence: ReturnType<typeof startBoardPersistence>;

function login(email: string | null = OWNER) {
  initSession(
    email ? { ...ANONYMOUS_SESSION, authenticated: true, email } : { ...ANONYMOUS_SESSION },
  );
}

async function fetchColumn(locationIds = ['l1'], status: 'new' | 'done' = 'new') {
  await client.fetchQuery({
    queryKey: handoverKeys.column(locationIds, status),
    queryFn: () => Promise.resolve(columnData()),
  });
  await settle();
}
async function fetchTask(id: string, locationIds = ['l1']) {
  await client.fetchQuery({
    queryKey: handoverKeys.one(id, locationIds),
    queryFn: () => Promise.resolve(dto(id)),
  });
  await settle();
}

function record(
  owner: string,
  rest: string,
  extra: Record<string, unknown>,
  v = BOARD_STORE_VERSION,
  savedAt = 1_000,
): DeviceRecord {
  return { key: `${owner}|${rest}`, owner, v, savedAt, ...extra };
}

beforeEach(() => {
  resetDeviceDbForTests();
  globalThis.indexedDB = new IDBFactory();
  resetBoardPersistForTests();
  vi.mocked(deviceDb.readAllRecords).mockClear();
  vi.mocked(deviceDb.writeRecords).mockClear();
  login();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  persistence = startBoardPersistence(client);
});
afterEach(() => {
  persistence.stop();
  client.clear();
  clearSession();
});

describe('penyimpan papan', () => {
  it('sukses non-manual kolom ditulis dengan owner, v, savedAt, dan kunci', async () => {
    await fetchColumn();
    await persistence.flush();
    const rows = await readAllRecords('columns');
    expect(rows).toHaveLength(1);
    const state = client.getQueryState(handoverKeys.column(['l1'], 'new'));
    expect(rows[0]).toMatchObject({
      key: `${OWNER}|l1|new`,
      owner: OWNER,
      v: 1,
      savedAt: state?.dataUpdatedAt,
    });
    expect(await readAllRecords('tasks')).toEqual([]);
  });

  it('sukses non-manual detail ditulis ke toko tasks', async () => {
    await fetchTask('h1');
    await persistence.flush();
    const rows = await readAllRecords('tasks');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `${OWNER}|h1`,
      owner: OWNER,
      locationIds: ['l1'],
      dto: dto('h1'),
    });
  });

  it('setQueryData (manual) pada kunci papan tidak menulis', async () => {
    client.setQueryData(handoverKeys.column(['l1'], 'new'), columnData());
    client.setQueryData(handoverKeys.one('h1', ['l1']), dto('h1'));
    await settle();
    await persistence.flush();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
  });

  it('kunci non-papan tidak ditulis', async () => {
    await client.fetchQuery({ queryKey: ['brands', 'list'], queryFn: () => Promise.resolve([]) });
    await settle();
    await persistence.flush();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
  });

  it('tanpa sesi tidak menulis', async () => {
    await fetchColumn();
    login(null);
    await persistence.flush();
    expect(await readAllRecords('columns')).toEqual([]);
  });

  it('memotong kolom pada batas halaman utuh dan mempertahankan nextCursor', async () => {
    const pages = [page(20, 'a', 'c1'), page(20, 'b', 'c2'), page(20, 'c', null)];
    await client.fetchInfiniteQuery({
      queryKey: handoverKeys.column(['l1'], 'new'),
      queryFn: ({ pageParam }) =>
        Promise.resolve(pages[pageParam === 'c2' ? 2 : pageParam === 'c1' ? 1 : 0] as BoardPageDto),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: BoardPageDto) => last.nextCursor ?? undefined,
      pages: 3,
    });
    await settle();
    await persistence.flush();
    const [row] = await readAllRecords('columns');
    const data = row?.data as BoardColumnData;
    expect(data.pages).toHaveLength(2);
    expect(data.pageParams).toEqual([undefined, 'c1']);
    expect(data.pages[1]?.nextCursor).toBe('c2');
  });

  it('memanggil writeRecords dengan batas pemangkasan 40 kolom dan 100 detail', async () => {
    await fetchColumn();
    await fetchTask('h1');
    await persistence.flush();
    const calls = vi.mocked(deviceDb.writeRecords).mock.calls;
    expect(calls.find((c) => c[0] === 'columns')?.[2]).toBe(40);
    expect(calls.find((c) => c[0] === 'tasks')?.[2]).toBe(100);
  });

  it('menulis 101 detail menyisakan 100', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, i) =>
        client.fetchQuery({
          queryKey: handoverKeys.one(`h${i}`, ['l1']),
          queryFn: () => Promise.resolve(dto(`h${i}`)),
        }),
      ),
    );
    await settle();
    await persistence.flush();
    expect(await readAllRecords('tasks')).toHaveLength(100);
  });

  it('balapan keluar (a): flush berjalan lalu keluar, toko tetap kosong', async () => {
    await fetchColumn();
    await fetchTask('h1');
    void persistence.flush();
    clearSession();
    await clearBoardStore();
    await settle();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
  });

  it('balapan keluar (b): catatan tertunda dibuang saat keluar, flush sesudahnya tidak menulis', async () => {
    await fetchColumn();
    clearSession();
    await clearBoardStore();
    await persistence.flush();
    expect(await readAllRecords('columns')).toEqual([]);
  });

  it('balapan keluar (c): sesi yang sama masuk lagi tak menghidupkan tulis lama (tulis kedua sesudah clear)', async () => {
    await fetchColumn();
    await fetchTask('h1');
    void persistence.flush();
    await clearBoardStore();
    login();
    await settle();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
  });
});

describe('restoreBoardCache', () => {
  async function seedStore() {
    await deviceDb.writeRecords(
      'columns',
      [
        record(OWNER, 'l1|new', { data: columnData() }, 1, 5_000),
        record('b@x.id', 'l1|new', { data: columnData() }),
        record(OWNER, 'l1|done', { data: columnData() }, 0),
        // Pemilik `a@x.id|b`: awalan kunci sama dengan pemilik sah, kolom `owner` berbeda.
        { key: `${OWNER}|b|l1|new`, owner: `${OWNER}|b`, v: 1, savedAt: 1, data: columnData() },
      ],
      40,
    );
    await deviceDb.writeRecords(
      'tasks',
      [record(OWNER, 'h1', { locationIds: ['l1'], dto: dto('h1') }, 1, 7_000)],
      100,
    );
  }

  it('memasang rekaman pemilik sah dengan savedAt asli dan membuang sisanya', async () => {
    await seedStore();
    expect(await restoreBoardCache(client, OWNER)).toBe(2);
    expect(client.getQueryData(handoverKeys.column(['l1'], 'new'))).toEqual(columnData());
    expect(client.getQueryState(handoverKeys.column(['l1'], 'new'))?.dataUpdatedAt).toBe(5_000);
    expect(client.getQueryData(handoverKeys.one('h1', ['l1']))).toEqual(dto('h1'));
    expect(client.getQueryState(handoverKeys.one('h1', ['l1']))?.dataUpdatedAt).toBe(7_000);
    await sleep(20);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual([`${OWNER}|l1|new`]);
    expect((await readAllRecords('tasks')).map((r) => r.key)).toEqual([`${OWNER}|h1`]);
  });

  it('pemilik berbeda: tidak memulihkan apa pun dan toko dikosongkan', async () => {
    await deviceDb.writeRecords('columns', [record(OWNER, 'l1|new', { data: columnData() })], 40);
    expect(await restoreBoardCache(client, 'b@x.id')).toBe(0);
    expect(client.getQueryCache().findAll()).toHaveLength(0);
    await sleep(20);
    expect(await readAllRecords('columns')).toEqual([]);
  });

  it('melewati kunci yang sudah berdata di cache', async () => {
    await seedStore();
    client.setQueryData(handoverKeys.column(['l1'], 'new'), columnData(1));
    expect(await restoreBoardCache(client, OWNER)).toBe(1);
    expect(client.getQueryData(handoverKeys.column(['l1'], 'new'))).toEqual(columnData(1));
  });

  it('label waktu: pemulihan tidak ditulis ulang oleh penyimpan', async () => {
    await seedStore();
    await restoreBoardCache(client, OWNER);
    await settle();
    await persistence.flush();
    await sleep(20);
    const rows = await readAllRecords('columns');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.savedAt).toBe(5_000);
    expect((await readAllRecords('tasks'))[0]?.savedAt).toBe(7_000);
  });

  it('timeout: hasil baca yang terlambat tidak diterapkan', async () => {
    await seedStore();
    const actual = await vi
      .importActual<typeof import('@/lib/device-db')>('@/lib/device-db')
      .then((m) => m.readAllRecords);
    vi.mocked(deviceDb.readAllRecords).mockImplementation(async (store) => {
      await sleep(100);
      return actual(store);
    });
    const started = Date.now();
    expect(await restoreBoardCache(client, OWNER, { timeoutMs: 20 })).toBe(0);
    expect(Date.now() - started).toBeLessThan(90);
    await sleep(200);
    expect(client.getQueryCache().findAll()).toHaveLength(0);
    vi.mocked(deviceDb.readAllRecords).mockImplementation(actual);
  });

  it('timeout: pembuangan rekaman pemilik lain/versi lain tetap berjalan sesudah bacaan lambat selesai', async () => {
    await seedStore();
    const actual = await vi
      .importActual<typeof import('@/lib/device-db')>('@/lib/device-db')
      .then((m) => m.readAllRecords);
    vi.mocked(deviceDb.readAllRecords).mockImplementation(async (store) => {
      await sleep(100);
      return actual(store);
    });
    expect(await restoreBoardCache(client, OWNER, { timeoutMs: 20 })).toBe(0);
    expect(client.getQueryCache().findAll()).toHaveLength(0);
    await sleep(400);
    expect(client.getQueryCache().findAll()).toHaveLength(0);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual([`${OWNER}|l1|new`]);
    expect((await readAllRecords('tasks')).map((r) => r.key)).toEqual([`${OWNER}|h1`]);
    vi.mocked(deviceDb.readAllRecords).mockImplementation(actual);
  });

  describe('bentuk rekaman rusak dibuang dan tidak dipasang', () => {
    const goodTask = { locationIds: ['l1'], dto: dto('h1') };
    const cases: [string, 'columns' | 'tasks', string, Record<string, unknown>][] = [
      ['data.pages bukan larik', 'columns', 'l1|new', { data: { pages: 'x', pageParams: [] } }],
      [
        'panjang pages dan pageParams berbeda',
        'columns',
        'l1|new',
        { data: { pages: [page(1, 'a', null)], pageParams: [] } },
      ],
      [
        'page.items bukan larik',
        'columns',
        'l1|new',
        { data: { pages: [{ items: 'x', nextCursor: null, total: 1 }], pageParams: [undefined] } },
      ],
      [
        'page.total bukan angka',
        'columns',
        'l1|new',
        { data: { pages: [{ items: [], nextCursor: null, total: '1' }], pageParams: [undefined] } },
      ],
      [
        'page.nextCursor bukan string atau null',
        'columns',
        'l1|new',
        { data: { pages: [{ items: [], nextCursor: 5, total: 1 }], pageParams: [undefined] } },
      ],
      ['dto.id tidak cocok dengan kunci', 'tasks', 'h1', { ...goodTask, dto: dto('lain') }],
      [
        'dto.checklist bukan larik',
        'tasks',
        'h1',
        { ...goodTask, dto: { ...dto('h1'), checklist: 'x' } },
      ],
      [
        'item kolom {}',
        'columns',
        'l1|new',
        { data: { pages: [{ items: [{}], nextCursor: null, total: 1 }], pageParams: [undefined] } },
      ],
      [
        'item kolom tanpa checklist',
        'columns',
        'l1|new',
        {
          data: {
            pages: [{ items: [{ ...dto('a'), checklist: undefined }], nextCursor: null, total: 1 }],
            pageParams: [undefined],
          },
        },
      ],
      [
        'item kolom tanpa comments',
        'columns',
        'l1|new',
        {
          data: {
            pages: [{ items: [{ ...dto('a'), comments: undefined }], nextCursor: null, total: 1 }],
            pageParams: [undefined],
          },
        },
      ],
      [
        'item kolom ber-id bukan string',
        'columns',
        'l1|new',
        {
          data: {
            pages: [{ items: [{ ...dto('a'), id: 5 }], nextCursor: null, total: 1 }],
            pageParams: [undefined],
          },
        },
      ],
      [
        'dto.comments bukan larik',
        'tasks',
        'h1',
        { ...goodTask, dto: { ...dto('h1'), comments: undefined } },
      ],
      [
        'dto.locationId bukan string',
        'tasks',
        'h1',
        { ...goodTask, dto: { ...dto('h1'), locationId: 5 } },
      ],
    ];
    for (const [name, store, rest, extra] of cases) {
      it(name, async () => {
        await deviceDb.writeRecords(store, [record(OWNER, rest, extra)], 10);
        await deviceDb.writeRecords(
          'columns',
          [record(OWNER, 'l2|new', { data: columnData() })],
          10,
        );
        expect(await restoreBoardCache(client, OWNER)).toBe(1);
        expect(client.getQueryData(handoverKeys.column(['l2'], 'new'))).toEqual(columnData());
        expect(
          store === 'columns'
            ? client.getQueryData(handoverKeys.column(['l1'], 'new'))
            : client.getQueryData(handoverKeys.one('h1', ['l1'])),
        ).toBeUndefined();
        await sleep(30);
        expect((await readAllRecords(store)).map((r) => r.key)).not.toContain(`${OWNER}|${rest}`);
        expect((await readAllRecords('columns')).map((r) => r.key)).toContain(`${OWNER}|l2|new`);
      });
    }
  });

  it('tanpa IndexedDB: tidak menolak', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    resetDeviceDbForTests();
    expect(await restoreBoardCache(client, OWNER)).toBe(0);
    await expect(persistence.flush()).resolves.toBeUndefined();
    await expect(clearBoardStore()).resolves.toBeUndefined();
    await fetchColumn();
    await expect(persistence.flush()).resolves.toBeUndefined();
  });
});
