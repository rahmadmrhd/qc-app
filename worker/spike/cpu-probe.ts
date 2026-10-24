// Spike Task 0.3: probe CPU Worker pada paket gratis. SEMENTARA; jangan dipakai di worker final.
//
// Akun QC belum punya subdomain workers.dev, jadi skenario dipicu tanpa URL publik: handler
// `scheduled` (cron tiap menit) memasukkan pesan ke Queue, dan konsumen Queue (satu pesan per
// invokasi) menjalankan skenario. Dengan begitu CPU konsumen Queue (pertanyaan terbuka Spek §2b)
// dan CPU tiap skenario diukur dari `cpuTime` di `wrangler tail`. Skenario badan-permintaan
// dijalankan lewat `new Request(...).text()` agar biaya baca badan ikut terhitung.
//
// Rute HTTP /probe/<nama> (header x-spike-key) disertakan untuk dipakai bila subdomain tersedia.

import b64Text from './payload-b64.txt';
import jsonText from './payload-json.txt';

interface Stmt {
  bind(...v: unknown[]): Stmt;
  run(): Promise<unknown>;
  all(): Promise<{ results: Record<string, unknown>[] }>;
}
interface D1 {
  prepare(sql: string): Stmt;
  batch(s: Stmt[]): Promise<unknown[]>;
}
interface Msg {
  id: string;
  kind: string;
  units?: number;
}
interface QueueMsg {
  body: Msg;
  attempts: number;
  ack(): void;
}
interface Env {
  DB: D1;
  JOBS: {
    send(m: Msg): Promise<void>;
    sendBatch(m: { body: Msg }[]): Promise<void>;
  };
  KEY: string;
}

// Timer Workers tidak maju selama loop sinkron, jadi beban CPU dinyatakan dalam jumlah iterasi
// (1 unit = 100 ribu iterasi); kalibrasi ke milidetik dilakukan dari cpuTime di log tail.
function burn(units: number): number {
  let x = 0;
  for (let i = 0; i < units * 100000; i++) x += Math.sqrt(i + x);
  return x;
}

const body = (text: string) => new Request('https://x.invalid/', { method: 'POST', body: text });

async function setup(env: Env): Promise<void> {
  const q = (sql: string) => env.DB.prepare(sql).run();
  await q(
    'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, k TEXT, name TEXT, status TEXT, updated_at TEXT)',
  );
  await q('CREATE INDEX IF NOT EXISTS items_k ON items(k)');
  await q('CREATE INDEX IF NOT EXISTS items_s ON items(status, updated_at)');
  await q('CREATE TABLE IF NOT EXISTS qlog (id TEXT, kind TEXT, attempts INTEGER, phase TEXT)');
  await q('CREATE TABLE IF NOT EXISTS ctr (k TEXT PRIMARY KEY, v INTEGER)');
  await q("INSERT OR IGNORE INTO ctr VALUES ('c', 0)");
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM items').all();
  if (Number(have.results[0].n) < 2000) {
    for (let b = 0; b < 20; b++) {
      const stmts: Stmt[] = [];
      for (let i = 0; i < 100; i++) {
        const n = b * 100 + i;
        stmts.push(
          env.DB.prepare('INSERT OR IGNORE INTO items VALUES (?,?,?,?,?)').bind(
            `i${n}`,
            `item ${n} merk`,
            `Item ${n}`,
            n % 3 ? 'active' : 'inactive',
            new Date(1.7e12 + n * 1000).toISOString(),
          ),
        );
      }
      await env.DB.batch(stmts);
    }
  }
}

async function run(kind: string, units: number, env: Env): Promise<unknown> {
  switch (kind) {
    case 'baseline':
      return { ok: true };
    case 'json-parse': {
      const text = await body(jsonText).text();
      const v = JSON.parse(text) as unknown[];
      return { n: v.length, bytes: text.length };
    }
    case 'forward-b64': {
      // Meneruskan base64 tanpa decode: baca teks, sambung ke amplop jembatan.
      const text = await body(b64Text).text();
      const envelope = `{"action":"createFile","ts":1,"sig":"x","payload":{"b64":"${text}"}}`;
      return { bytes: envelope.length };
    }
    case 'atob': {
      const text = await body(b64Text).text();
      return { bytes: atob(text).length };
    }
    case 'd1-batch': {
      // 10 kueri dalam satu batch: 3 tulis + 7 baca berindeks.
      const r = Math.floor(Math.random() * 1900);
      const s = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b);
      const out = await env.DB.batch([
        s("UPDATE ctr SET v = v + 1 WHERE k = 'c' RETURNING v"),
        s('INSERT INTO qlog VALUES (?,?,?,?)', `b${Date.now()}`, 'x', 0, 'batch'),
        s('UPDATE items SET name = ? WHERE id = ?', `Item ${r} x`, `i${r}`),
        s('SELECT * FROM items WHERE id = ?', `i${r}`),
        s("SELECT * FROM items WHERE status = 'active' ORDER BY updated_at DESC LIMIT 21"),
        s('SELECT * FROM items WHERE k LIKE ? LIMIT 20', `item ${r}%`),
        s('SELECT COUNT(*) AS n FROM items WHERE status = ?', 'inactive'),
        s('SELECT * FROM items WHERE id IN (?,?,?,?,?)', 'i1', 'i2', 'i3', 'i4', 'i5'),
        s('SELECT id FROM items WHERE k = ?', `item ${r} merk`),
        s("SELECT v FROM ctr WHERE k = 'c'"),
      ]);
      return { n: out.length };
    }
    case 'burn':
      burn(units);
      return { burned: units };
    default:
      throw new Error(`skenario tak dikenal: ${kind}`);
  }
}

// Jadwal pesan per menit: jumlah per skenario; beban 'burn' menguji batas CPU konsumen.
const PLAN: { kind: string; units?: number; count: number }[] = [
  { kind: 'baseline', count: 15 },
  { kind: 'json-parse', count: 15 },
  { kind: 'forward-b64', count: 15 },
  { kind: 'atob', count: 15 },
  { kind: 'd1-batch', count: 15 },
  { kind: 'burn', units: 10, count: 2 },
  { kind: 'burn', units: 30, count: 2 },
  { kind: 'burn', units: 100, count: 2 },
  { kind: 'burn', units: 300, count: 2 },
  { kind: 'burn', units: 1000, count: 2 },
  { kind: 'burn', units: 5000, count: 2 },
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('x-spike-key') !== env.KEY) return new Response('no', { status: 401 });
    const name = url.pathname.replace(/^\/probe\//, '');
    if (name === 'setup') {
      await setup(env);
      return Response.json({ ok: true });
    }
    if (name === 'qlog') {
      const rows = await env.DB.prepare(
        "SELECT kind, phase, COUNT(*) AS n FROM qlog WHERE phase != 'batch' GROUP BY kind, phase ORDER BY kind, phase",
      ).all();
      return Response.json(rows.results);
    }
    return Response.json(await run(name, Number(url.searchParams.get('units') ?? '1'), env));
  },

  // Cron: hanya memasukkan pesan (CPU ringan), seperti rancangan produksi (Spek §10).
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const t = Date.now();
    const msgs: { body: Msg }[] = [];
    for (const p of PLAN) {
      for (let i = 0; i < p.count; i++) {
        const id = `${t}-${p.kind}${p.units ?? ''}-${i}`;
        msgs.push({ body: { id, kind: p.kind, units: p.units } });
      }
    }
    for (let i = 0; i < msgs.length; i += 100) await env.JOBS.sendBatch(msgs.slice(i, i + 100));
  },

  async queue(batch: { messages: QueueMsg[] }, env: Env): Promise<void> {
    for (const m of batch.messages) {
      const { id, kind, units } = m.body;
      const label = `burn${units}`;
      // Catatan mulai/selesai hanya untuk skenario burn: mendeteksi konsumen yang dihentikan.
      if (kind === 'burn') {
        await env.DB.prepare('INSERT INTO qlog VALUES (?,?,?,?)')
          .bind(id, label, m.attempts, 'start')
          .run();
      }
      await run(kind, units ?? 0, env);
      if (kind === 'burn') {
        await env.DB.prepare('INSERT INTO qlog VALUES (?,?,?,?)')
          .bind(id, label, m.attempts, 'done')
          .run();
      }
      m.ack();
    }
  },
};
