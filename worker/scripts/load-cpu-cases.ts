import { HANDOVER_WORKER_BATCH } from '@shared/handover';
import { auditCursorAfter, LOAD_SIZES, newTaskNote } from './load-cpu-lib';

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
  /**
   * Perkiraan baris DITULIS D1 per panggilan (baris + entri indeks, termasuk audit); 0 untuk rute baca. Dipakai
   * mencetak anggaran kuota tulis D1 (100.000 baris/hari) di awal `run`.
   */
  writes: number;
  request(i: number): LoadRequest;
}

export interface CaseContext {
  nowMs: number;
  syncToken: string;
}

/** Sampel per rute (rute tulis juga): p95 pada 100 sampel = sampel ke-95; lonjakan tunggal tidak menentukan hasil. */
export const SAMPLES = 100;

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
  const brandNo = (n % LOAD_SIZES.brands) + 1;
  return {
    brand: `Merk Uji ${brandNo}`,
    model: `Model ${PRODUCTS[n % PRODUCTS.length]} ${n}`,
    aliases: n % 5 === 0 ? [`Alias ${n}`, `Nama lain ${n}`] : [],
  };
}

const LOC_JKT = ['loc-jkt'];

/**
 * Pembagian task Baru khusus rute tulis (`lt-1`..`lt-${LOAD_SIZES.newTasks}`, 20 butir, loc-jkt). Rentang
 * TIDAK saling tumpang tindih supaya tiap panggilan benar-benar menulis (setCheck/setDone/cancel yang sudah
 * sesuai keadaannya tidak menulis apa pun dan akan mengukur jalur ringan yang menipu).
 */
const TASKS = {
  setCheck: { from: 1, count: 30 }, // 30 task x 4 butir berbeda = 120 pasangan unik
  setDone: { from: 31, count: SAMPLES },
  cancel: { from: 131, count: SAMPLES }, // dibatalkan lalu dibuka kembali (reopen) pada rute berikutnya
  update: { from: 231, count: SAMPLES },
  comment: { from: 331, count: 70 }, // 100 komentar umum + 100 berjangkar: <= 3 per task
} as const;

/** Item bernomor tidak kelipatan 23 (kelipatan 23 sudah nonaktif pada data beban: setStatus tak menulis). */
const ACTIVE_POOL = Array.from({ length: SAMPLES + 10 }, (_, k) => 200 + k).filter(
  (n) => n % 23 !== 0,
);
const activeItemNo = (i: number) => ACTIVE_POOL[i] as number;

/**
 * Daftar rute beserta muatan terbesar yang realistis. Urutan: baca dulu, tulis ringan, lalu tulis berat dan
 * yang mengubah data referensi (rename merk) paling akhir. Berkas (`files.*`) dilewati: jembatan Google belum
 * dapat dipakai dari staging.
 */
export function buildCases(ctx: CaseContext): LoadCase[] {
  const spec = (
    name: string,
    make: (i: number) => LoadRequest,
    writes = 0,
    calls = SAMPLES,
  ): LoadCase => ({ name, calls, writes, request: make });
  return [
    spec('GET /api/ping', () => ({ method: 'GET', path: '/api/ping', auth: 'none' })),
    spec('GET /api/boot', () => ({ method: 'GET', path: '/api/boot', auth: 'cookie' })),
    spec('auth.me', () => rpc('auth.me', null)),
    spec('items.list', () => rpc('items.list', { limit: 50 })),
    spec('items.list:cursor', (i) =>
      rpc('items.list', { limit: 50, cursor: `merk uji ${1 + (i % 39)} model` }),
    ),
    spec('items.list:query', (i) =>
      rpc('items.list', { limit: 50, query: i % 2 === 0 ? 'router' : 'model switch 1' }),
    ),
    spec('items.get', (i) => rpc('items.get', { id: `li-${1 + i * 7}` })),
    spec('brands.list', () => rpc('brands.list', null)),
    spec('customers.list', () => rpc('customers.list', null)),
    spec('handovers.board:new', () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'new' }),
    ),
    spec('handovers.board:in_progress', () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'in_progress' }),
    ),
    spec('handovers.board:done', () =>
      rpc('handovers.board', { locationIds: LOC_JKT, status: 'done' }),
    ),
    spec('handovers.board:cancelled', () =>
      rpc('handovers.board', {
        locationIds: ['loc-jkt', 'loc-bdg'],
        status: 'cancelled',
      }),
    ),
    spec('handovers.get', (i) =>
      rpc('handovers.get', {
        id: `lt-${1 + ((200 + i * 13) % LOAD_SIZES.tasks)}`,
        locationIds: ['loc-jkt', 'loc-bdg'],
      }),
    ),
    spec('handovers.options', () => rpc('handovers.options', { locationIds: LOC_JKT })),
    spec('access.audit.list', () => rpc('access.audit.list', { limit: 50 })),
    spec('access.audit.list:action', () =>
      rpc('access.audit.list', { limit: 50, action: 'handover.check' }),
    ),
    spec('access.audit.list:query', () =>
      rpc('access.audit.list', { limit: 50, query: 'target12' }),
    ),
    spec('access.audit.list:cursor', (i) =>
      rpc('access.audit.list', {
        limit: 50,
        cursor: auditCursorAfter(ctx.nowMs, 50 * (1 + (i % 39) * 4)),
      }),
    ),
    spec('access.users.list', () => rpc('access.users.list', null)),
    spec('access.roles.list', () => rpc('access.roles.list', null)),
    spec('access.locations.list', () => rpc('access.locations.list', null)),
    spec('qrcodes.list', () => rpc('qrcodes.list', null)),
    spec('qrcodes.getDefaults', () => rpc('qrcodes.getDefaults', null)),
    spec('sync.ping', () => syncCall(ctx, 'sync.ping', null)),
    spec('sync.items.pull:50+detail', (i) =>
      syncCall(ctx, 'sync.items.pull', {
        sinceRev: 1000 + (i % 10) * 100,
        limit: 50,
        include: ['detail', 'stickers', 'accessories'],
      }),
    ),
    spec('sync.items.pull:500', (i) =>
      syncCall(ctx, 'sync.items.pull', { sinceRev: (i % 10) * 100, limit: 500 }),
    ),
    spec('sync.brands.pull:500', () =>
      syncCall(ctx, 'sync.brands.pull', { sinceRev: 0, limit: 500 }),
    ),

    // ---- tulis ringan ----
    spec(
      'access.users.save',
      (i) =>
        rpc('access.users.save', {
          id: 'user-wh',
          email: 'wh@dev.test',
          name: `Staf WH ${i}`,
          status: 'active',
          assignments: [{ locationId: null, roleIds: ['role-wh'] }],
        }),
      5,
    ),
    spec(
      'items.setStatus',
      (i) => rpc('items.setStatus', { id: `li-${activeItemNo(i)}`, status: 'inactive' }),
      8,
    ),
    spec(
      'items.save',
      (i) => {
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
      },
      9,
    ),
    spec(
      'handovers.setCheck',
      (i) => {
        const k = TASKS.setCheck.from + (i % TASKS.setCheck.count);
        const j = Math.floor(i / TASKS.setCheck.count) + 1;
        return rpc('handovers.setCheck', {
          id: `lt-${k}`,
          locationId: 'loc-jkt',
          index: j - 1,
          text: `Barang ${k}-${j} = ${j} pcs`,
          checked: true,
        });
      },
      6,
    ),
    spec(
      'handovers.setDone',
      (i) =>
        rpc('handovers.setDone', { id: `lt-${TASKS.setDone.from + i}`, locationId: 'loc-jkt' }),
      6,
    ),
    spec(
      'handovers.comment:general',
      (i) =>
        rpc('handovers.comment', {
          id: `lt-${TASKS.comment.from + (i % TASKS.comment.count)}`,
          locationId: 'loc-jkt',
          quote: '',
          before: '',
          after: '',
          body: `Komentar umum beban ${i}: mohon konfirmasi jadwal kirim.`,
        }),
      6,
    ),
    spec(
      'handovers.comment:anchored',
      (i) => {
        const k = TASKS.comment.from + (i % TASKS.comment.count);
        return rpc('handovers.comment', {
          id: `lt-${k}`,
          locationId: 'loc-jkt',
          quote: `Barang ${k}-3 = 3 pcs`,
          before: '',
          after: '',
          body: `Komentar berjangkar beban ${i}.`,
        });
      },
      6,
    ),
    spec(
      'handovers.cancel',
      (i) => rpc('handovers.cancel', { id: `lt-${TASKS.cancel.from + i}`, locationId: 'loc-jkt' }),
      6,
    ),
    spec(
      'handovers.reopen',
      (i) => rpc('handovers.reopen', { id: `lt-${TASKS.cancel.from + i}`, locationId: 'loc-jkt' }),
      6,
    ),
    spec(
      'handovers.save:update',
      (i) => {
        const k = TASKS.update.from + i;
        return rpc('handovers.save', {
          id: `lt-${k}`,
          locationId: 'loc-jkt',
          customerName: `PT Pelanggan Uji ${1 + (i % 5)}`,
          note: `${newTaskNote(k)}\n- [ ] Tambahan beban ${i} = 1 pcs`,
        });
      },
      6,
    ),
    spec(
      'handovers.save:create',
      (i) =>
        rpc('handovers.save', {
          locationId: 'loc-jkt',
          customerName: `PT Pelanggan Uji ${1 + (i % 5)}`,
          note: bigNote(`S${i}`),
        }),
      9,
    ),
    // ---- tulis berat ----
    spec(
      'handovers.saveBatch:5x5000',
      (i) =>
        rpc('handovers.saveBatch', {
          locationId: 'loc-jkt',
          tasks: Array.from({ length: HANDOVER_WORKER_BATCH }, (_, t) => ({
            customerName: `PT Pelanggan Uji ${1 + ((i + t) % 5)}`,
            note: bigNote(`B${i}-${t}`),
          })),
        }),
      HANDOVER_WORKER_BATCH * 8 + 1,
    ),
    spec(
      'sync.items.push:5+detail',
      (i) =>
        syncCall(ctx, 'sync.items.push', {
          overwrite: true,
          items: Array.from({ length: 5 }, (_, t) => {
            // 1.700 item (301..2000) dipakai berputar: putaran kedua memperbarui item yang sama (isi beda).
            const n = 301 + ((i * 5 + t) % (LOAD_SIZES.items - 300));
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
      5 * 8,
    ),
    // ---- mengubah data referensi (paling akhir) ----
    spec(
      'brands.save:rename(~50 item)',
      (i) =>
        rpc('brands.save', {
          id: `lb-${1 + (i % LOAD_SIZES.brands)}`,
          name: `Merk Uji ${1 + (i % LOAD_SIZES.brands)} Baru ${i}`,
        }),
      4 + Math.round(LOAD_SIZES.items / LOAD_SIZES.brands) * 3,
    ),
  ];
}

/** Perkiraan total baris ditulis D1 satu `run` penuh (atau sebagian bila `only` diberikan). */
export function estimateRunWrites(cases: readonly LoadCase[]): number {
  return cases.reduce((sum, c) => sum + c.calls * c.writes, 0);
}
