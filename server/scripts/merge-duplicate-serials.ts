// Penyatuan Serial Number ganda lintas BU (spek serial unik se-sistem §8 butir 2; keputusan pemilik 2026-11-18).
//
//   bun run --cwd server scripts/merge-duplicate-serials.ts [opsi]
//
// BAWAAN = DRY-RUN: hanya membaca (SELECT) dan menulis laporan CSV; tidak menulis ke basis data.
//   --apply                      menyatukan (wajib bersama --confirm-database)
//   --confirm-database <nama>    harus sama dengan nama skema pada DATABASE_URL (pengaman salah sasaran)
//   --report-dir <folder>        folder laporan CSV (bawaan ./merge-serials-report; berisi Serial Number, diabaikan git)
//
// Aturan penyatuan per Serial Number yang ada di lebih dari satu catatan:
//   - SERIAL TERHAPUS (soft delete) DIABAIKAN SEPENUHNYA (keputusan pemilik 2026-11-21): hanya catatan HIDUP yang dihitung
//     sebagai ganda dan yang dipilih jadi pemenang; catatan terhapus tak dipindahkan dan tak dihapus permanen.
//   - PEMENANG: catatan yang punya laporan aktif; bila tak ada, yang berstatus Rusak; bila tak ada, yang terbaru
//     (tanggal uji, lalu id terbesar). Lebih dari satu catatan dengan laporan aktif = tidak otomatis ("perlu-manual":
//     dilewati dan dilaporkan; selesaikan salah satu laporannya dulu).
//   - Seluruh data catatan yang KALAH dipindahkan ke pemenang, bukan dibuang: kejadian (nomor `seq` disusun ulang
//     menurut waktu, dengan kejadian `note` "Digabung dari BU X" di titik awal riwayat catatan itu), kasus laporan,
//     jumlah tempel stiker (dijumlahkan bila stikernya sama), entri stok, foto bukti, notifikasi, dan gambar pesan.
//   - BU catatan yang kalah masuk `serial_business_units` sebagai "sudah ditinggalkan" (`left_at` terisi), jadi terkunci
//     dari cek ulang berikutnya seperti BU lain yang pernah dilewati dan tetap dapat membaca riwayatnya.
//   - Semua perubahan SATU serial ada dalam SATU transaksi (gagal = tidak ada yang berubah untuk serial itu).
//
// PENYIMPANGAN yang disengaja (disetujui, spek serial unik se-sistem §8 butir 2): skrip operator ini meng-UPDATE
// `serial_events` (`serial_id` dan `seq`; kejadian kalah dipindahkan dan seq disusun ulang) dan `sticker_stock_entries.serial_id`,
// memindahkan baris anak lain (kasus, jumlah stiker, foto bukti, notifikasi, pemilik berkas) dan menghapus catatan serial
// yang kalah. Tes statis `events-append-only.test.ts` hanya memindai `server/src`, bukan skrip ini; isi kejadian (waktu,
// pelaku, pesan, data) tidak pernah diubah.
//
// Setelah selesai tanpa sisa serial ganda, mulai ulang server (atau jalankan `ensureSerialUniqueIndex`) agar indeks unik
// `serials_serial` dibuat. Laporan CSV berisi Serial Number: JANGAN di-commit.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb, type Db, type DbTx } from '@server/core/db';
import { csvCell } from './csv-cell';

export interface DupRow {
  id: string;
  buId: string;
  buCode: string;
  serial: string;
  itemId: string;
  testDate: string;
  status: string;
  openCaseId: string;
  createdAt: string;
}

export type WinnerReason = 'laporan-aktif' | 'rusak' | 'terbaru';

export type GroupPlan =
  | { kind: 'merge'; serial: string; winner: DupRow; reason: WinnerReason; losers: DupRow[] }
  | { kind: 'manual'; serial: string; rows: DupRow[]; why: string };

const tierOf = (row: DupRow): number =>
  row.openCaseId !== '' ? 2 : row.status === 'broken' ? 1 : 0;

const compareRows = (a: DupRow, b: DupRow): number =>
  tierOf(b) - tierOf(a) ||
  (a.testDate < b.testDate ? 1 : a.testDate > b.testDate ? -1 : 0) ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Memilih pemenang untuk satu kelompok (murni). */
export function planGroup(serial: string, rows: DupRow[]): GroupPlan {
  const withCase = rows.filter((row) => row.openCaseId !== '');
  if (withCase.length > 1) {
    return {
      kind: 'manual',
      serial,
      rows,
      why: 'lebih dari satu catatan punya laporan aktif; selesaikan salah satunya dulu',
    };
  }
  const sorted = [...rows].sort(compareRows);
  const winner = sorted[0] as DupRow;
  const tier = tierOf(winner);
  return {
    kind: 'merge',
    serial,
    winner,
    reason: tier === 2 ? 'laporan-aktif' : tier === 1 ? 'rusak' : 'terbaru',
    losers: sorted.slice(1),
  };
}

const COLUMNS =
  's.id, s.bu_id, bu.code AS bu_code, s.serial, s.item_id, s.test_date, s.status, s.open_case_id, s.created_at';

interface RawRow {
  id: string;
  bu_id: string;
  bu_code: string | null;
  serial: string;
  item_id: string;
  test_date: string;
  status: string;
  open_case_id: string;
  created_at: string;
}

const toRow = (raw: RawRow): DupRow => ({
  id: raw.id.trim(),
  buId: raw.bu_id.trim(),
  buCode: (raw.bu_code ?? '').trim(),
  serial: raw.serial,
  itemId: raw.item_id.trim(),
  testDate: raw.test_date,
  status: raw.status.trim(),
  openCaseId: raw.open_case_id.trim(),
  createdAt: raw.created_at,
});

/** Semua catatan yang Serial Number-nya ada di lebih dari satu catatan, dikelompokkan per serial. */
export async function findDuplicateGroups(db: Db | DbTx): Promise<Map<string, DupRow[]>> {
  const rows = await db
    .prepare(
      `SELECT ${COLUMNS} FROM serials s LEFT JOIN business_units bu ON bu.id = s.bu_id WHERE s.deleted_at = '' AND s.serial IN (SELECT serial FROM serials WHERE serials.deleted_at = '' GROUP BY serial HAVING COUNT(*) > 1) ORDER BY s.serial, s.id`,
    )
    .all<RawRow>();
  const groups = new Map<string, DupRow[]>();
  for (const raw of rows.results) {
    const row = toRow(raw);
    groups.set(row.serial, [...(groups.get(row.serial) ?? []), row]);
  }
  return groups;
}

export function planAll(groups: Map<string, DupRow[]>): GroupPlan[] {
  return [...groups.entries()].map(([serial, rows]) => planGroup(serial, rows));
}

interface EventRow {
  id: string;
  seq: number | string;
  created_at: string;
  occurred_on: string;
}

/** Batas seq per sumber pada pergeseran sementara (menghindari bentrok indeks unik `(serial_id, seq)`). */
const SEQ_SHIFT = 1_000_000;

async function foldEvents(tx: DbTx, plan: Extract<GroupPlan, { kind: 'merge' }>, now: string) {
  const sources = [plan.winner, ...plan.losers];
  interface Entry {
    id: string;
    createdAt: string;
    tie: number;
    source: number;
    seq: number;
    note: { loser: DupRow; occurredOn: string } | null;
  }
  const entries: Entry[] = [];
  for (const [index, source] of sources.entries()) {
    const events = await tx
      .prepare(
        'SELECT id, seq, created_at, occurred_on FROM serial_events WHERE serial_id = ? ORDER BY seq',
      )
      .bind(source.id)
      .all<EventRow>();
    const maxSeq = events.results.reduce((max, event) => Math.max(max, Number(event.seq)), 0);
    if (maxSeq >= SEQ_SHIFT) throw new Error(`seq terlalu besar pada serial ${source.id}`);
    for (const event of events.results) {
      entries.push({
        id: event.id.trim(),
        createdAt: event.created_at,
        tie: 1,
        source: index,
        seq: Number(event.seq),
        note: null,
      });
    }
    if (index > 0) {
      // Penanda penyatuan di titik awal riwayat catatan yang kalah.
      const first = events.results[0];
      entries.push({
        id: crypto.randomUUID(),
        createdAt: first?.created_at ?? source.createdAt,
        tie: 0,
        source: index,
        seq: 0,
        note: { loser: source, occurredOn: first?.occurred_on ?? source.testDate },
      });
    }
  }
  // Geser dulu semua kejadian lama ke rentang sementara yang terpisah per sumber (loser dipindah ke pemenang).
  for (const [index, source] of sources.entries()) {
    await tx
      .prepare('UPDATE serial_events SET serial_id = ?, seq = seq + ? WHERE serial_id = ?')
      .bind(plan.winner.id, (index + 1) * SEQ_SHIFT, source.id)
      .run();
  }
  entries.sort(
    (a, b) =>
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      a.tie - b.tie ||
      a.source - b.source ||
      a.seq - b.seq,
  );
  for (const [position, entry] of entries.entries()) {
    const seq = position + 1;
    if (entry.note === null) {
      await tx.prepare('UPDATE serial_events SET seq = ? WHERE id = ?').bind(seq, entry.id).run();
      continue;
    }
    const { loser, occurredOn } = entry.note;
    await tx
      .prepare(
        "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, '', ?, 'note', ?, ?, '', 'Skrip penyatuan', 'qc', ?, '[]', ?)",
      )
      .bind(
        entry.id,
        plan.winner.id,
        seq,
        occurredOn,
        entry.createdAt,
        `Digabung dari BU ${loser.buCode || loser.buId}`,
        JSON.stringify({
          mergedFrom: { serialId: loser.id, buId: loser.buId, buCode: loser.buCode, at: now },
        }),
      )
      .run();
  }
}

async function foldLoser(tx: DbTx, winner: DupRow, loser: DupRow, now: string): Promise<void> {
  const from = loser.id;
  const to = winner.id;
  await tx
    .prepare('UPDATE serial_cases SET serial_id = ? WHERE serial_id = ?')
    .bind(to, from)
    .run();
  // Jumlah tempel stiker: dijumlahkan bila stikernya sama.
  const stickers = await tx
    .prepare('SELECT sticker_id, qty FROM serial_stickers WHERE serial_id = ?')
    .bind(from)
    .all<{ sticker_id: string; qty: number | string }>();
  for (const sticker of stickers.results) {
    await tx
      .prepare(
        'INSERT INTO serial_stickers (serial_id, sticker_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)',
      )
      .bind(to, sticker.sticker_id.trim(), Number(sticker.qty))
      .run();
  }
  await tx.prepare('DELETE FROM serial_stickers WHERE serial_id = ?').bind(from).run();
  await tx
    .prepare('UPDATE sticker_stock_entries SET serial_id = ? WHERE serial_id = ?')
    .bind(to, from)
    .run();
  await tx
    .prepare('UPDATE serial_proof_photos SET serial_id = ? WHERE serial_id = ?')
    .bind(to, from)
    .run();
  await tx
    .prepare('UPDATE notifications SET serial_id = ? WHERE serial_id = ?')
    .bind(to, from)
    .run();
  await tx
    .prepare(
      "UPDATE files SET owner_id = ? WHERE owner_id = ? AND owner_type IN ('serial', 'serialproof')",
    )
    .bind(to, from)
    .run();
  // Riwayat BU: BU catatan yang kalah (dan BU lamanya) masuk ke pemenang sebagai sudah ditinggalkan.
  await tx
    .prepare(
      "INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at) SELECT id, bu_id, created_at, '' FROM serials WHERE id IN (?, ?)",
    )
    .bind(to, from)
    .run();
  await tx
    .prepare(
      "INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at) SELECT ?, bu_id, first_at, CASE WHEN left_at = '' THEN ? ELSE left_at END FROM serial_business_units WHERE serial_id = ?",
    )
    .bind(to, now, from)
    .run();
  await tx.prepare('DELETE FROM serial_business_units WHERE serial_id = ?').bind(from).run();
}

export type MergeOutcome =
  | { kind: 'merged'; plan: Extract<GroupPlan, { kind: 'merge' }> }
  | { kind: 'manual'; plan: Extract<GroupPlan, { kind: 'manual' }> }
  | { kind: 'gone' };

/** Menyatukan SATU Serial Number dalam satu transaksi (baris dikunci `FOR UPDATE` dan dinilai ulang di dalamnya). */
export function mergeSerial(db: Db, serial: string, now: string): Promise<MergeOutcome> {
  return db.transaction(async (tx): Promise<MergeOutcome> => {
    const locked = await tx
      .prepare(
        `SELECT ${COLUMNS} FROM serials s LEFT JOIN business_units bu ON bu.id = s.bu_id WHERE s.serial = ? AND s.deleted_at = '' ORDER BY s.id FOR UPDATE`,
      )
      .bind(serial)
      .all<RawRow>();
    const rows = locked.results.map(toRow);
    if (rows.length < 2) return { kind: 'gone' };
    const plan = planGroup(serial, rows);
    if (plan.kind === 'manual') return { kind: 'manual', plan };
    await foldEvents(tx, plan, now);
    for (const loser of plan.losers) await foldLoser(tx, plan.winner, loser, now);
    for (const loser of plan.losers) {
      await tx.prepare('DELETE FROM serials WHERE id = ?').bind(loser.id).run();
    }
    return { kind: 'merged', plan };
  });
}

export function reportCsv(plans: GroupPlan[], applied: boolean): string {
  const header = [
    'serial',
    'id_pemenang',
    'bu_pemenang',
    'alasan_pemenang',
    'id_dilipat',
    'bu_dilipat',
    'hasil',
  ];
  const rows: string[][] = [];
  for (const plan of plans) {
    if (plan.kind === 'manual') {
      for (const row of plan.rows) {
        rows.push([plan.serial, '', '', '', row.id, row.buCode, `perlu-manual: ${plan.why}`]);
      }
      continue;
    }
    for (const loser of plan.losers) {
      rows.push([
        plan.serial,
        plan.winner.id,
        plan.winner.buCode,
        plan.reason,
        loser.id,
        loser.buCode,
        applied ? 'digabung' : 'rencana',
      ]);
    }
  }
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

interface Args {
  apply: boolean;
  confirmDatabase: string;
  reportDir: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirmDatabase: '', reportDir: './merge-serials-report' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} butuh nilai`);
      return next;
    };
    if (flag === '--apply') args.apply = true;
    else if (flag === '--confirm-database') args.confirmDatabase = value();
    else if (flag === '--report-dir') args.reportDir = value();
    else throw new Error(`Argumen tak dikenal: ${flag}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? '';
  if (url === '') throw new Error('DATABASE_URL tidak diset');
  const databaseName = new URL(url).pathname.replace(/^\//, '') || '';
  console.log(`Tujuan: ${new URL(url).host}/${databaseName} (hanya dibaca bila dry-run)`);
  const db = createDb({ url, connectionLimit: 2 });
  try {
    const plans = planAll(await findDuplicateGroups(db));
    const merges = plans.filter((plan) => plan.kind === 'merge');
    const manual = plans.filter((plan) => plan.kind === 'manual');
    console.log(
      `Serial ganda: ${plans.length} (otomatis ${merges.length}, perlu manual ${manual.length})`,
    );
    const dir = resolve(args.reportDir);
    await mkdir(dir, { recursive: true });
    if (!args.apply) {
      await Bun.write(resolve(dir, 'penyatuan-serial.csv'), reportCsv(plans, false));
      console.log(`Laporan CSV (rencana): ${dir}`);
      console.log(
        '\nDRY-RUN selesai: tidak ada yang ditulis. Tambahkan --apply --confirm-database <nama> untuk menyatukan.',
      );
      return;
    }
    if (args.confirmDatabase !== databaseName) {
      throw new Error(
        `--confirm-database "${args.confirmDatabase}" tidak sama dengan skema tujuan "${databaseName}"; dibatalkan`,
      );
    }
    const now = new Date().toISOString();
    const outcomes: GroupPlan[] = [];
    for (const plan of plans) {
      const outcome = await mergeSerial(db, plan.serial, now);
      if (outcome.kind === 'merged' || outcome.kind === 'manual') outcomes.push(outcome.plan);
    }
    await Bun.write(resolve(dir, 'penyatuan-serial.csv'), reportCsv(outcomes, true));
    console.log(`Selesai: ${outcomes.filter((p) => p.kind === 'merge').length} serial disatukan.`);
    console.log(`Laporan CSV: ${dir}`);
    if (manual.length > 0) {
      console.log(
        `Masih ada ${manual.length} serial yang perlu ditangani manual; indeks unik belum dapat dibuat.`,
      );
    } else {
      console.log('Mulai ulang server agar indeks unik serials_serial dibuat.');
    }
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
