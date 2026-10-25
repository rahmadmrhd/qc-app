import { auditCursorAfter, newTaskNote } from './load-cpu-lib';

export interface LoadRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** `cookie` = sesi admin uji + X-Requested-With; `none` = tanpa kredensial (token ada di badan). */
  auth: 'cookie' | 'none';
}

export interface LoadCase {
  /** Nama rute pada tabel; dikirim sebagai `?r=` agar dapat dicocokkan dengan peristiwa tail. */
  name: string;
  calls: number;
  request(i: number): LoadRequest;
}

export interface CaseContext {
  nowMs: number;
  syncToken: string;
}

const PRODUCTS = [
  'Router',
  'Switch',
  'Access Point',
  'Kabel UTP',
  'Adaptor PoE',
  'Antena',
  'Rack ear',
  'Modul SFP',
  'Patch panel',
  'Konektor RJ45',
];

const rpc = (method: string, payload: unknown): LoadRequest => ({
  method: 'POST',
  path: '/api/rpc',
  body: { method, payload },
  auth: 'cookie',
});

const syncCall = (ctx: CaseContext, method: string, payload: unknown): LoadRequest => ({
  method: 'POST',
  path: '/sync',
  body: { v: 1, method, token: ctx.syncToken, payload },
  auth: 'none',
});

/** Catatan 4.9xx karakter (< 5.000) berisi banyak butir: muatan `saveBatch` terbesar yang realistis. */
export function bigNote(label: string): string {
  const lines: string[] = [];
  let size = 0;
  for (let j = 1; size < 4850; j++) {
    const line = `- [ ] ${PRODUCTS[j % PRODUCTS.length]} ${label}-${j} = ${j % 20} unit`;
    lines.push(line);
    size += line.length + 1;
  }
  return `${lines.join('\n')}\n`;
}

function itemNaming(n: number) {
  const brandNo = (n % 40) + 1;
  return {
    brand: `Merk Uji ${brandNo}`,
    model: `Model ${PRODUCTS[n % PRODUCTS.length]} ${n}`,
    aliases: n % 5 === 0 ? [`Alias ${n}`, `Nama lain ${n}`] : [],
  };
}

const LOC_JKT = ['loc-jkt'];

/**
 * Daftar rute beserta muatan terbesar yang realistis. Urutan: baca dulu, tulis ringan, lalu tulis berat dan
 * yang mengubah data referensi (rename merk) paling akhir. Berkas (`files.*`) dilewati: jembatan Google belum
 * dapat dipakai dari staging.
 */
export function buildCases(ctx: CaseContext): LoadCase[] {
  const listFirst = (name: string, calls: number, make: (i: number) => LoadRequest): LoadCase => ({
    name,
    calls,
    request: make,
  });
  const cases: LoadCase[] = [
    {
      name: 'GET /api/ping',
      calls: 40,
      request: () => ({ method: 'GET', path: '/api/ping', auth: 'none' }),
    },
    {
      name: 'GET /api/boot',
      calls: 40,
      request: () => ({ method: 'GET', path: '/api/boot', auth: 'cookie' }),
    },
    listFirst('auth.me', 40, () => rpc('auth.me', null)),
    listFirst('items.list', 40, () => rpc('items.list', { limit: 50 })),
    listFirst('items.list:cursor', 40, (i) =>
      rpc('items.list', { limit: 50, cursor: `merk uji ${1 + (i % 39)} model` }),
    ),
    listFirst('items.list:query', 40, (i) =>
      rpc('items.list', { limit: 50, query: i % 2 === 0 ? 'router' : 'model switch 1' }),
    ),
    listFirst('items.get', 40, (i) => rpc('items.get', { id: `li-${1 + i * 7}` })),
    listFirst('brands.list', 40, () => rpc('brands.list', null)),
    listFirst('customers.list', 40, () => rpc('customers.list', null)),
    listFirst('handovers.board:new', 40, () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'new', limit: 50 }),
    ),
    listFirst('handovers.board:in_progress', 40, () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'in_progress', limit: 50 }),
    ),
    listFirst('handovers.board:done', 40, () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'done', limit: 50 }),
    ),
    listFirst('handovers.board:cancelled', 40, () =>
      rpc('handovers.board', {
        locationIds: ['loc-jkt', 'loc-bdg'],
        status: 'cancelled',
        limit: 50,
      }),
    ),
    listFirst('handovers.get', 40, (i) =>
      rpc('handovers.get', { id: `lt-${200 + i * 13}`, locationIds: ['loc-jkt', 'loc-bdg'] }),
    ),
    listFirst('handovers.options', 40, () => rpc('handovers.options', { locationIds: LOC_JKT })),
    listFirst('access.audit.list', 40, () => rpc('access.audit.list', { limit: 50 })),
    listFirst('access.audit.list:action', 40, () =>
      rpc('access.audit.list', { limit: 50, action: 'handover.check' }),
    ),
    listFirst('access.audit.list:query', 40, () =>
      rpc('access.audit.list', { limit: 50, query: 'target12' }),
    ),
    listFirst('access.audit.list:cursor', 40, (i) =>
      rpc('access.audit.list', {
        limit: 50,
        cursor: auditCursorAfter(ctx.nowMs, 50 * (1 + i * 4)),
      }),
    ),
    listFirst('access.users.list', 40, () => rpc('access.users.list', null)),
    listFirst('access.roles.list', 40, () => rpc('access.roles.list', null)),
    listFirst('access.locations.list', 40, () => rpc('access.locations.list', null)),
    listFirst('qrcodes.list', 30, () => rpc('qrcodes.list', null)),
    listFirst('qrcodes.getDefaults', 30, () => rpc('qrcodes.getDefaults', null)),
    listFirst('sync.ping', 30, () => syncCall(ctx, 'sync.ping', null)),
    listFirst('sync.items.pull:200+detail', 30, (i) =>
      syncCall(ctx, 'sync.items.pull', {
        sinceRev: 1000 + (i % 10) * 100,
        limit: 200,
        include: ['detail', 'stickers', 'accessories'],
      }),
    ),
    listFirst('sync.items.pull:500', 30, (i) =>
      syncCall(ctx, 'sync.items.pull', { sinceRev: (i % 10) * 100, limit: 500 }),
    ),
    listFirst('sync.brands.pull:500', 30, () =>
      syncCall(ctx, 'sync.brands.pull', { sinceRev: 0, limit: 500 }),
    ),

    // ---- tulis ringan ----
    listFirst('access.users.save', 30, (i) =>
      rpc('access.users.save', {
        id: 'user-wh',
        email: 'wh@dev.test',
        name: `Staf WH ${i}`,
        status: 'active',
        assignments: [{ locationId: null, roleIds: ['role-wh'] }],
      }),
    ),
    listFirst('items.setStatus', 30, (i) =>
      rpc('items.setStatus', { id: `li-${200 + i}`, status: 'inactive' }),
    ),
    listFirst('items.save', 30, (i) => {
      const n = 100 + i;
      const naming = itemNaming(n);
      return rpc('items.save', {
        id: `li-${n}`,
        ...naming,
        isCountryLock: n % 17 === 0,
        stickers: [{ name: 'Label SNI', note: 'Bagian belakang bodi', fileId: null }],
        accessories: [{ name: 'Kabel daya', qty: 1 }],
        attachments: [],
        detail: `## ${naming.brand} ${naming.model}\n\n${'Spesifikasi diperbarui. '.repeat(40)}\n\nRevisi beban ${i}.`,
      });
    }),
    listFirst('handovers.setCheck', 60, (i) => {
      const k = 1 + (i % 30);
      const j = i < 30 ? 1 : 2;
      return rpc('handovers.setCheck', {
        id: `lt-${k}`,
        locationId: 'loc-jkt',
        index: j - 1,
        text: `Barang ${k}-${j} = ${j} pcs`,
        checked: true,
      });
    }),
    listFirst('handovers.setDone', 30, (i) =>
      rpc('handovers.setDone', { id: `lt-${31 + i}`, locationId: 'loc-jkt' }),
    ),
    listFirst('handovers.comment:general', 30, (i) =>
      rpc('handovers.comment', {
        id: `lt-${91 + i}`,
        locationId: 'loc-jkt',
        quote: '',
        before: '',
        after: '',
        body: `Komentar umum beban ${i}: mohon konfirmasi jadwal kirim.`,
      }),
    ),
    listFirst('handovers.comment:anchored', 30, (i) => {
      const k = 91 + i;
      return rpc('handovers.comment', {
        id: `lt-${k}`,
        locationId: 'loc-jkt',
        quote: `Barang ${k}-3 = 3 pcs`,
        before: '',
        after: '',
        body: `Komentar berjangkar beban ${i}.`,
      });
    }),
    listFirst('handovers.cancel', 30, (i) =>
      rpc('handovers.cancel', { id: `lt-${61 + i}`, locationId: 'loc-jkt' }),
    ),
    listFirst('handovers.reopen', 30, (i) =>
      rpc('handovers.reopen', { id: `lt-${61 + i}`, locationId: 'loc-jkt' }),
    ),
    listFirst('handovers.save:update', 30, (i) => {
      const k = 121 + i;
      return rpc('handovers.save', {
        id: `lt-${k}`,
        locationId: 'loc-jkt',
        customerName: `PT Pelanggan Uji ${1 + (i % 5)}`,
        note: `${newTaskNote(k)}\n- [ ] Tambahan beban ${i} = 1 pcs`,
      });
    }),
    listFirst('handovers.save:create', 30, (i) =>
      rpc('handovers.save', {
        locationId: 'loc-jkt',
        customerName: `PT Pelanggan Uji ${1 + (i % 5)}`,
        note: bigNote(`S${i}`),
      }),
    ),
    // ---- tulis berat ----
    listFirst('handovers.saveBatch:30x5000', 30, (i) =>
      rpc('handovers.saveBatch', {
        locationId: 'loc-jkt',
        tasks: Array.from({ length: 30 }, (_, t) => ({
          customerName: `PT Pelanggan Uji ${1 + ((i + t) % 5)}`,
          note: bigNote(`B${i}-${t}`),
        })),
      }),
    ),
    listFirst('sync.items.push:25+detail', 30, (i) =>
      syncCall(ctx, 'sync.items.push', {
        overwrite: true,
        items: Array.from({ length: 25 }, (_, t) => {
          const n = 301 + i * 25 + t;
          const naming = itemNaming(n);
          return {
            uid: `li-${n}`,
            id: null,
            merk: naming.brand,
            tipe: naming.model,
            isCountryLock: n % 17 === 0,
            images: [],
            detail: `## ${naming.brand} ${naming.model}\n\nDetail dari Desktop ${i}-${t}. ${'Catatan. '.repeat(60)}`,
            stickers: [{ name: 'Label SNI', note: 'Belakang', image: null }],
            accessories: [{ name: 'Kabel daya', qty: 1 }],
            active: true,
          };
        }),
      }),
    ),
    // ---- mengubah data referensi (paling akhir) ----
    listFirst('brands.save:rename(~50 item)', 30, (i) =>
      rpc('brands.save', { id: `lb-${1 + i}`, name: `Merk Uji ${1 + i} Baru` }),
    ),
  ];
  return cases;
}
