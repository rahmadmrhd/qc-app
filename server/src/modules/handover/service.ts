import type { AuditInput } from '@server/core/audit';
import { writeAudit, writeAuditRows } from '@server/core/audit';
import { CAS_FAIL_SQL, runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { listLocationBriefs } from '@server/modules/access/repo';
import type { CustomerRecord } from '@server/modules/customer/repo';
import { insertCustomerStmts, listCustomers } from '@server/modules/customer/repo';
import { lookupCustomerForWrite, planCustomerByName } from '@server/modules/customer/service';
import {
  customerKey,
  dateKeyOf,
  deriveHandoverStatus,
  HANDOVER_LIMITS,
  HANDOVER_WORKER_BATCH,
  handoverNumber,
} from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import { normalizeNoteChecks, reconcileChecks } from '@shared/handover-checklist';
import {
  handoverNormalizeAnchorText,
  locateAnchor,
  noteToPlainText,
} from '@shared/handover-comments';
import { handoverCanonicalText } from '@shared/handover-text';
import type {
  AddCommentInput,
  BoardPageDto,
  BoardPageInput,
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverRefInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/rpc';
import { checklistOf, matchedChecks } from './checklist';
import type {
  CommentStats,
  HandoverRecord,
  HandoverRow,
  LoadedHandover,
  StoredComment,
} from './repo';
import {
  commentsJsonSql,
  findHandoverWithComments,
  HANDOVER_COLUMNS,
  HANDOVER_FROM,
  insertHandoverStmts,
  listComments,
  parseStoredComments,
  toHandover,
  updateHandoverStmt,
} from './repo';
import { BOARD_DEFAULT_LIMIT, handoverNoteError, parseBoardCursor } from './validate';

const STALE_MESSAGE = 'Task sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

export async function locationNameMap(env: Env): Promise<Map<string, string>> {
  const rows = await listLocationBriefs(env);
  return new Map(rows.map((row) => [row.id, row.name] as const));
}

/** Progres checklist dari catatan dan centang tersimpan. */
function progressOf(handover: Pick<HandoverRecord, 'note' | 'checks' | 'completedAt'>): {
  total: number;
  done: number;
  completed: boolean;
} {
  const matched = matchedChecks(handover.note, handover.checks);
  return {
    total: matched.length,
    done: matched.filter((check) => check !== null).length,
    completed: handover.completedAt !== '',
  };
}

export function toHandoverDto(
  handover: HandoverRecord,
  customerName: string,
  comments: readonly StoredComment[],
): HandoverDto {
  const entries = checklistOf(handover.note);
  const matched = matchedChecks(handover.note, handover.checks);
  const done = matched.reduce((n, check) => (check === null ? n : n + 1), 0);
  // Teks polos catatan hanya dihitung bila ada komentar berjangkar (hemat CPU).
  const plain = comments.some((comment) => comment.quote !== '')
    ? noteToPlainText(handover.note)
    : '';
  return {
    id: handover.id,
    number: handover.number,
    locationId: handover.locationId,
    customerId: handover.customerId,
    customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, {
      total: entries.length,
      done,
      completed: handover.completedAt !== '',
    }),
    checklist: entries.map((entry) => {
      const check = matched[entry.index] ?? null;
      return {
        index: entry.index,
        text: entry.text,
        checked: check !== null,
        by: check?.by ?? '',
        at: check?.at ?? '',
      };
    }),
    comments: comments.map((comment) => ({
      ...comment,
      // Komentar umum (kutipan kosong) tidak pernah usang.
      stale:
        comment.quote !== '' &&
        locateAnchor(plain, {
          quote: comment.quote,
          before: comment.before,
          after: comment.after,
        }) === null,
    })),
    completedAt: handover.completedAt,
    completedBy: handover.completedBy,
    createdAt: handover.createdAt,
    createdBy: handover.createdBy,
    updatedAt: handover.updatedAt,
    updatedBy: handover.updatedBy,
  };
}

async function dtoOf(env: Env, loaded: LoadedHandover): Promise<HandoverDto> {
  const comments =
    loaded.comments ?? (await listComments(env, [loaded.record.id])).get(loaded.record.id) ?? [];
  return toHandoverDto(loaded.record, loaded.customerName, comments);
}

// ---------------------------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------------------------

interface BoardRow extends HandoverRow {
  checked_count: number;
  total_count: number;
  /** Komentar task (larik JSON dari subkueri; lihat `COMMENTS_JSON_SQL`). */
  comments_json: string | null;
}

/**
 * Satu kolom kanban per panggilan (Spek 7.4): terbaru dahulu (`updated_at`, lalu nomor); pada Dikerjakan
 * progres lebih kecil di atas. Kursor keyset; `total` = jumlah task di kolom itu. Lokasi baris diperiksa
 * lewat `locationIds` yang sudah diizinkan router.
 */
export async function handoverBoard(
  env: Env,
  input: BoardPageInput,
  locationIds: readonly string[],
): Promise<BoardPageDto> {
  const limit = input.limit ?? BOARD_DEFAULT_LIMIT;
  const inList = locationIds.map(() => '?').join(',');
  const base = `h.location_id IN (${inList}) AND h.board_status = ?`;
  const baseBinds: unknown[] = [...locationIds, input.status];
  const cursor = input.cursor ? parseBoardCursor(input.status, input.cursor) : null;
  const where: string[] = [base];
  const binds: unknown[] = [...baseBinds];
  const progress = '(h.checked_count * 1000 / h.total_count)';
  if (cursor) {
    if (input.status === 'in_progress') {
      where.push(
        `(${progress} > ? OR (${progress} = ? AND (h.updated_at < ? OR (h.updated_at = ? AND h.number < ?))))`,
      );
      binds.push(
        cursor.progress,
        cursor.progress,
        cursor.updatedAt,
        cursor.updatedAt,
        cursor.number,
      );
    } else {
      where.push('(h.updated_at < ? OR (h.updated_at = ? AND h.number < ?))');
      binds.push(cursor.updatedAt, cursor.updatedAt, cursor.number);
    }
  }
  const order =
    input.status === 'in_progress'
      ? `${progress} ASC, h.updated_at DESC, h.number DESC`
      : 'h.updated_at DESC, h.number DESC';
  const outerOrder =
    input.status === 'in_progress'
      ? '(p.checked_count * 1000 / p.total_count) ASC, p.updated_at DESC, p.number DESC'
      : 'p.updated_at DESC, p.number DESC';
  // Halaman beserta komentarnya dalam SATU kueri (komentar lewat subkueri atas halaman yang sudah dibatasi
  // LIMIT) dan jumlah kolom dalam batch yang sama: satu round trip D1 per halaman. COUNT hanya memindai
  // indeks kolom itu; kolom besar memang membutuhkannya (halaman penuh) dan kolom kecil murah.
  const pageStatement = env.DB.prepare(
    `SELECT p.*, ${commentsJsonSql('p')} FROM (SELECT ${HANDOVER_COLUMNS}, h.checked_count, h.total_count FROM ${HANDOVER_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?) p ORDER BY ${outerOrder}`,
  ).bind(...binds, limit + 1);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS n FROM handovers h WHERE ${base}`).bind(
    ...baseBinds,
  );
  const [pageResult, countResult] = await env.DB.batch([pageStatement, countStatement]);
  const rows = (pageResult?.results ?? []) as BoardRow[];
  const total = Number((countResult?.results[0] as { n: number } | undefined)?.n ?? 0);
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  let nextCursor: string | null = null;
  if (rows.length > limit && last) {
    nextCursor =
      input.status === 'in_progress'
        ? `${Math.floor((last.checked_count * 1000) / last.total_count)}|${last.updated_at}|${last.number}`
        : `${last.updated_at}|${last.number}`;
  }
  return {
    items: pageRows.map((row) => {
      const record = toHandover(row);
      return toHandoverDto(
        record,
        row.current_customer_name ?? record.customerName,
        parseStoredComments(row.comments_json),
      );
    }),
    nextCursor,
    total,
  };
}

/**
 * Detail satu task. Lokasi baris task HARUS salah satu lokasi yang diizinkan router (`locationIds` dari `ctx`);
 * bila tidak, `NOT_FOUND`.
 */
export async function getHandoverDto(
  env: Env,
  input: GetHandoverInput,
  locationIds: readonly string[] = input.locationIds,
): Promise<HandoverDto> {
  const found = await findHandoverWithComments(env, input.id);
  if (!found || !locationIds.includes(found.loaded.record.locationId)) {
    throw appError('NOT_FOUND', 'Task tidak ditemukan');
  }
  return dtoOf(env, found.loaded);
}

/** Customer aktif untuk saran di form task (diambil lewat izin serah terima, bukan izin customer). */
export async function handoverOptions(env: Env): Promise<HandoverOptionsDto> {
  const customers = await listCustomers(env);
  return {
    customers: customers
      .filter((customer) => customer.status === 'active')
      .map((customer) => ({ id: customer.id, name: customer.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    inactiveCustomerNames: customers
      .filter((customer) => customer.status === 'inactive')
      .map((customer) => customer.name)
      .sort((a, b) => a.localeCompare(b)),
  };
}

// ---------------------------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------------------------

/** Catatan penuh dulu (batas catatan); dipotong ke panjang ini hanya bila JSON > 40.000, berurutan dari yang longgar. */
const HANDOVER_AUDIT_NOTE_STEPS = [2000, 400, 0] as const;
const HANDOVER_AUDIT_TRUNCATED = ' (dipotong)';

/** Snapshot audit: butir tercentang sebagai daftar teks. `note` hanya dimuat bila `noteLimit` diberikan. */
export function handoverSnapshot(
  handover: HandoverRecord,
  customerName: string,
  locationNames: ReadonlyMap<string, string>,
  noteLimit: number | null = null,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    number: handover.number,
    location: locationNames.get(handover.locationId) ?? handover.locationId,
    customer: customerName,
    status: deriveHandoverStatus(handover.status, progressOf(handover)),
    checked: matchedChecks(handover.note, handover.checks)
      .filter((check) => check !== null)
      .map((check) => check?.text ?? ''),
  };
  if (noteLimit !== null) {
    snapshot.note =
      handover.note.length > noteLimit
        ? `${handover.note.slice(0, noteLimit)}${HANDOVER_AUDIT_TRUNCATED}`
        : handover.note;
  }
  return snapshot;
}

/** Pasangan snapshot yang muat di satu sel audit (JSON <= 40.000 karakter), disusun SEBELUM menulis. */
export function fitAuditSnapshots(
  build: (noteLimit: number | null) => {
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  },
  withNote: boolean,
): { before: Record<string, unknown> | null; after: Record<string, unknown> } {
  const limits: Array<number | null> = withNote
    ? [HANDOVER_LIMITS.note, ...HANDOVER_AUDIT_NOTE_STEPS]
    : [null];
  for (const limit of limits) {
    const pair = build(limit);
    if (
      JSON.stringify(pair.after).length <= HANDOVER_LIMITS.stateJson &&
      (pair.before === null || JSON.stringify(pair.before).length <= HANDOVER_LIMITS.stateJson)
    ) {
      return pair;
    }
  }
  const message = 'Perubahan terlalu besar untuk dicatat di audit; persingkat catatan';
  throw appError('VALIDATION', message, { note: message });
}

// ---------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------

/** Memuat task untuk ditulis. `NOT_FOUND` bila id tak ada ATAU lokasinya bukan `locationId` yang diizinkan. */
async function loadForWrite(
  env: Env,
  ref: HandoverRefInput,
  statsSql?: string,
): Promise<{ loaded: LoadedHandover; stats: CommentStats | null }> {
  // Task dan komentarnya sekaligus (satu round trip): DTO balasan tidak perlu membaca komentar lagi.
  const found = await findHandoverWithComments(env, ref.id, statsSql);
  if (!found || found.loaded.record.locationId !== ref.locationId) {
    throw appError('NOT_FOUND', 'Task tidak ditemukan');
  }
  return found;
}

/** Hanya task Dibatalkan yang terkunci (WH maupun QC). */
function assertNotCancelled(handover: HandoverRecord): void {
  if (handover.status === 'cancelled') {
    throw appError('CONFLICT', 'Task sudah dibatalkan dan tidak dapat diubah');
  }
}

/**
 * Benar bila sejak form dibuka (`base`) catatan dan customer sama dan status tidak berpindah ke/dari Selesai.
 * Perubahan lain di antaranya hanya centang/komentar/progres.
 */
function onlyProgressChanged(current: HandoverRecord, base: SaveHandoverInput['base']): boolean {
  if (!base) return false;
  const status = deriveHandoverStatus(current.status, progressOf(current));
  const statusMoved = (status === 'done') !== (base.status === 'done');
  return base.note === current.note && base.customerId === current.customerId && !statusMoved;
}

interface NumberReservation {
  numbers: string[];
  statements: DbStatement[];
}

/**
 * Menyediakan `count` nomor `ST-YYYYMMDD-NNN` berurutan untuk satu tanggal (WIB). Penghitung harian di
 * tabel `counters`; bila belum ada, dimulai dari urutan terbesar nomor yang sudah ada (mis. hasil impor).
 * Pernyataan yang dikembalikan (penjaga CAS + simpan penghitung dalam satu `INSERT ... ON CONFLICT`) HARUS berada di `batch()` yang sama dengan
 * penyisipan task: bila penulis lain menaikkan penghitung lebih dulu, batch dibatalkan dan pemanggil
 * mengulang (`runCas`). Nomor unik dijamin juga oleh indeks unik `handovers.number`.
 */
async function reserveNumbers(
  env: Env,
  dateKey: string,
  count: number,
): Promise<NumberReservation> {
  const key = `st:${dateKey}`;
  const row = await env.DB.prepare('SELECT value FROM counters WHERE key = ?')
    .bind(key)
    .first<{ value: number }>();
  let base: number;
  let expected: number;
  if (row) {
    base = row.value;
    expected = row.value;
  } else {
    const prefix = `ST-${dateKey}-`;
    const max = await env.DB.prepare(
      'SELECT MAX(CAST(substr(number, 13) AS INTEGER)) AS m FROM handovers WHERE number >= ? AND number < ?',
    )
      .bind(prefix, `ST-${dateKey}.`)
      .first<{ m: number | null }>();
    base = max?.m ?? 0;
    expected = -1;
  }
  return {
    numbers: Array.from({ length: count }, (_, i) => handoverNumber(dateKey, base + i + 1)),
    // Penjaga + simpan penghitung dalam SATU pernyataan: baris yang sudah berubah (`expected` tak cocok)
    // membatalkan batch (`integer overflow`); baris yang belum ada (`expected = -1`) disisipkan, dan bila
    // penulis lain menyisipkannya lebih dulu, cabang `DO UPDATE` yang gagal (nilai != -1) atau PRIMARY KEY.
    statements: [
      env.DB.prepare(
        `INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = CASE WHEN counters.value = ? THEN excluded.value ELSE ${CAS_FAIL_SQL} END`,
      ).bind(key, base + count, expected),
    ],
  };
}

interface NewTaskInput {
  customerName: string;
  note: string;
}

/**
 * Membuat 1..30 task SEKALIGUS dalam SATU `batch()` (atomik): penjaga/penyimpanan penghitung nomor, customer
 * baru (satu kali per kunci), task, dan audit tiap task. Gagal = tidak ada task, customer, atau nomor.
 * Diulang otomatis bila penulis lain merebut nomor/customer yang sama.
 */
async function createTasks(
  env: Env,
  locationId: string,
  tasks: readonly NewTaskInput[],
  actor: ActorRef,
): Promise<HandoverDto[]> {
  const locationNames = await locationNameMap(env);
  return runCas(async () => {
    const now = nowIso(env);
    const dateKey = dateKeyOf(nowOf(env));
    const reservation = await reserveNumbers(env, dateKey, tasks.length);
    const resolved = new Map<string, CustomerRecord>();
    const newCustomers: CustomerRecord[] = [];
    // Urutan audit = urutan kejadian: `customer.create` sebelum audit task pertama yang memakainya.
    const audits: AuditInput[] = [];
    const records: HandoverRecord[] = [];
    for (const [index, task] of tasks.entries()) {
      let customer: CustomerRecord | null = null;
      if (task.customerName !== '') {
        const key = customerKey(task.customerName);
        customer = resolved.get(key) ?? null;
        if (!customer) {
          const lookup = await lookupCustomerForWrite(env, task.customerName, actor);
          customer = lookup.customer;
          resolved.set(key, customer);
          if (lookup.created) {
            newCustomers.push(customer);
            audits.push(lookup.created);
          }
        }
      }
      const record: HandoverRecord = {
        id: crypto.randomUUID(),
        number: reservation.numbers[index] as string,
        locationId,
        customerId: customer?.id ?? '',
        customerName: customer?.name ?? '',
        note: task.note,
        status: 'open',
        checks: [],
        completedAt: '',
        completedBy: '',
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
        version: 1,
      };
      // Audit disusun dan diperiksa mutlak SEBELUM menulis apa pun.
      const audit = fitAuditSnapshots(
        (limit) => ({
          before: null,
          after: handoverSnapshot(record, record.customerName, locationNames, limit),
        }),
        true,
      );
      audits.push({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: record.number,
        before: null,
        after: audit.after,
      });
      records.push(record);
    }
    // Penghitung nomor (CAS), customer baru, task, lalu audit: INSERT banyak-baris, bukan satu pernyataan per
    // baris (batch 5 task = 3-4 pernyataan, bukan 12). Atomik dalam satu `batch()`.
    await env.DB.batch([
      ...reservation.statements,
      ...insertCustomerStmts(env.DB, newCustomers),
      ...insertHandoverStmts(env.DB, records),
      ...writeAuditRows(env.DB, audits),
    ]);
    return records.map((record) => toHandoverDto(record, record.customerName, []));
  }, 'Nomor task sedang direbut penulis lain; coba lagi');
}

export async function saveHandover(
  env: Env,
  input: SaveHandoverInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  // Centang hanya milik QC: "- [x]" dari penulis catatan dinormalkan.
  const note = normalizeNoteChecks(input.note);
  const noteError = handoverNoteError(note);

  if (!input.id) {
    if (noteError !== null) throw appError('VALIDATION', noteError, { note: noteError });
    const [dto] = await createTasks(
      env,
      input.locationId,
      [{ customerName: input.customerName, note }],
      actor,
    );
    return dto as HandoverDto;
  }
  const id = input.id;

  return runCas(async () => {
    const { loaded } = await loadForWrite(env, { id, locationId: input.locationId });
    const current = loaded.record;
    assertNotCancelled(current);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) {
      // Tanpa `base`, atau bila catatan/customer/status berubah oleh orang lain: CONFLICT. Hanya centang/komentar
      // yang berubah sejak form dibuka (base sama) bukan konflik; centang TERKINI tetap diselaraskan di bawah.
      if (!onlyProgressChanged(current, input.base)) throw appError('CONFLICT', STALE_MESSAGE);
    }
    if (noteError !== null) throw appError('VALIDATION', noteError, { note: noteError });

    // Validasi centang SEBELUM menulis apa pun (termasuk membuat customer).
    const reconciled = reconcileChecks(current.note, current.checks, note);
    if (reconciled.removed.length > 0) {
      const message = `Butir yang sudah dicentang tidak dapat dihapus: ${reconciled.removed.join('; ')}`;
      throw appError('VALIDATION', message, { note: message });
    }

    // Customer opsional: nama kosong = tanpa customer (tidak ada yang dibuat).
    const plan =
      input.customerName === ''
        ? null
        : await planCustomerByName(env, input.customerName, actor, current.customerId);
    const customer = plan?.customer ?? null;
    const locationNames = await locationNameMap(env);
    const now = nowIso(env);
    const next: HandoverRecord = {
      ...current,
      customerId: customer?.id ?? '',
      customerName: customer?.name ?? '',
      note,
      checks: reconciled.checks,
    };
    if (
      next.note === current.note &&
      next.customerId === current.customerId &&
      (customer?.name ?? '') === loaded.customerName
    ) {
      return dtoOf(env, loaded);
    }
    const resets = reconciled.resets.map((reset) => `${reset.from} → ${reset.to}`);
    const audit = fitAuditSnapshots(
      (limit) => ({
        before: handoverSnapshot(current, loaded.customerName, locationNames, limit),
        after: {
          ...handoverSnapshot(next, next.customerName, locationNames, limit),
          ...(resets.length > 0 ? { resets } : {}),
        },
      }),
      true,
    );
    const saved: HandoverRecord = {
      ...next,
      updatedAt: now,
      updatedBy: actor.email,
      version: current.version + 1,
    };
    await env.DB.batch([
      ...(plan?.statements ?? []),
      updateHandoverStmt(env.DB, saved, current.version),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'handover.update',
        target: current.number,
        before: audit.before,
        after: audit.after,
      }),
    ]);
    return toDtoAfter(saved, loaded);
  }, STALE_MESSAGE);
}

/**
 * Simpan banyak task atomik: SEMUA task divalidasi lebih dulu (batas, customer nonaktif); baru satu `batch()`
 * (nomor berurutan, customer baru sekali per kunci, task, audit). Galat sebelum penulisan = tidak ada task,
 * customer, atau nomor yang terpakai.
 */
export async function saveHandoverBatch(
  env: Env,
  input: SaveHandoverBatchInput,
  actor: ActorRef,
): Promise<HandoverDto[]> {
  if (input.tasks.length === 0 || input.tasks.length > HANDOVER_WORKER_BATCH) {
    const message = `Jumlah task harus 1–${HANDOVER_WORKER_BATCH}`;
    throw appError('VALIDATION', message, { tasks: message });
  }
  const customers = await listCustomers(env);
  const prepared = input.tasks.map((task, index) => {
    const fail = (field: string, message: string): never => {
      throw appError('VALIDATION', `Task ${index + 1}: ${message}`, {
        tasks: `Task ${index + 1}: ${message}`,
        [field]: message,
      });
    };
    const customerName = task.customerName.trim();
    const note = normalizeNoteChecks(task.note.trim());
    const noteError = handoverNoteError(note);
    if (noteError !== null) fail('note', noteError);
    if (customerName.length > HANDOVER_LIMITS.customerName) {
      fail('customerName', `Nama customer maksimal ${HANDOVER_LIMITS.customerName} karakter`);
    }
    if (customerName !== '') {
      const key = customerKey(customerName);
      if (key === '') fail('customerName', 'Nama customer harus memuat huruf atau angka');
      const found = customers.find((customer) => customer.key === key);
      if (found && found.status === 'inactive') {
        fail('customerName', 'Customer dinonaktifkan; aktifkan dulu di halaman Customer');
      }
    }
    return { customerName, note };
  });
  return createTasks(env, input.locationId, prepared, actor);
}

/** Nomor kemunculan butir `index` di antara butir bertulisan sama (mulai 0). */
function occurrenceAt(note: string, index: number): number {
  const entries = checklistOf(note);
  const target = entries[index];
  if (!target) return 0;
  return entries.filter((entry) => entry.index < index && entry.text === target.text).length;
}

function assertStateSize(checks: readonly CheckState[]): void {
  if (JSON.stringify(checks).length > HANDOVER_LIMITS.stateJson) {
    const message =
      'Data centang task ini melebihi batas 40.000 karakter; kurangi jumlah atau panjang butir checklist';
    throw appError('VALIDATION', message, { checks: message });
  }
}

/**
 * Menulis perubahan yang TIDAK mengubah catatan (centang/selesai/batal/buka) + audit dalam SATU batch dengan
 * CAS `version` (digabung ke `UPDATE`, lihat `updateHandoverStmt`); kolom turunan (`checked_count`, `total_count`, `board_status`) dihitung ulang oleh
 * `updateHandoverStmt`. Audit tanpa `note` diperiksa ukurannya SEBELUM menulis. Penjaga gagal -> dilempar
 * mentah agar pemanggil (`runCas`) memuat ulang dan mengulang.
 */
async function writeTaskChange(
  env: Env,
  loaded: LoadedHandover,
  patch: Partial<Pick<HandoverRecord, 'checks' | 'completedAt' | 'completedBy' | 'status'>>,
  action: string,
  actor: ActorRef,
  now: string,
): Promise<HandoverRecord> {
  const handover = loaded.record;
  const saved: HandoverRecord = {
    ...handover,
    ...patch,
    updatedAt: now,
    updatedBy: actor.email,
    version: handover.version + 1,
  };
  assertStateSize(saved.checks);
  const names = await locationNameMap(env);
  const audit = fitAuditSnapshots(
    () => ({
      before: handoverSnapshot(handover, loaded.customerName, names),
      after: handoverSnapshot(saved, loaded.customerName, names),
    }),
    false,
  );
  await env.DB.batch([
    updateHandoverStmt(env.DB, saved, handover.version),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action,
      target: handover.number,
      before: audit.before,
      after: audit.after,
    }),
  ]);
  return saved;
}

export async function setCheck(
  env: Env,
  input: SetCheckInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  return runCas(async () => {
    const { loaded } = await loadForWrite(env, input);
    const handover = loaded.record;
    assertNotCancelled(handover);
    const entry = checklistOf(handover.note)[input.index];
    // Penjaga: teks butir pada indeks harus sama dengan yang dilihat pengguna (catatan bisa berubah);
    // dibandingkan dalam bentuk kanonis (tanpa escape Markdown/entitas HTML).
    if (!entry || (entry.text !== input.text && entry.text !== handoverCanonicalText(input.text))) {
      throw appError('CONFLICT', 'Catatan berubah; muat ulang halaman lalu ulangi');
    }
    const occurrence = occurrenceAt(handover.note, input.index);
    const existing = matchedChecks(handover.note, handover.checks)[input.index] ?? null;
    // Idempoten: keadaan sudah sesuai (mis. diulang setelah penulis lain) = tidak menulis apa pun.
    if (input.checked === (existing !== null)) return dtoOf(env, loaded);
    const now = nowIso(env);
    const checks = input.checked
      ? [...handover.checks, { text: entry.text, by: actor.email, at: now, occurrence }]
      : handover.checks.filter(
          (check) =>
            !(handoverCanonicalText(check.text) === entry.text && check.occurrence === occurrence),
        );
    const saved = await writeTaskChange(
      env,
      loaded,
      { checks },
      input.checked ? 'handover.check' : 'handover.uncheck',
      actor,
      now,
    );
    return toDtoAfter(saved, loaded);
  }, STALE_MESSAGE);
}

/** DTO setelah tulis: komentar tidak berubah oleh perubahan isi/centang/status, jadi dipakai dari pemuatan awal. */
function toDtoAfter(saved: HandoverRecord, loaded: LoadedHandover): HandoverDto {
  return toHandoverDto(saved, loaded.customerName, loaded.comments ?? []);
}

/** Menyelesaikan task: mencentang semua butir yang belum (task tanpa butir ditandai selesai). Tidak ada buka kembali. */
export async function setDone(
  env: Env,
  input: SetDoneInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  return runCas(async () => {
    const { loaded } = await loadForWrite(env, input);
    const handover = loaded.record;
    assertNotCancelled(handover);
    const entries = checklistOf(handover.note);
    const matched = matchedChecks(handover.note, handover.checks);
    const now = nowIso(env);
    const missing = entries.filter((entry) => matched[entry.index] === null);
    const needsMark = entries.length === 0 && handover.completedAt === '';
    if (missing.length === 0 && !needsMark) return dtoOf(env, loaded);
    const checks = [
      ...handover.checks,
      ...missing.map((entry) => ({
        text: entry.text,
        by: actor.email,
        at: now,
        occurrence: occurrenceAt(handover.note, entry.index),
      })),
    ];
    const saved = await writeTaskChange(
      env,
      loaded,
      entries.length === 0 ? { checks, completedAt: now, completedBy: actor.email } : { checks },
      'handover.done',
      actor,
      now,
    );
    return toDtoAfter(saved, loaded);
  }, STALE_MESSAGE);
}

/** Perkiraan ukuran JSON satu komentar dalam SQL: panjang field + kerangka JSON (80 karakter, termasuk koma). */
const COMMENT_SIZE_SQL =
  'length(id) + length(quote) + length("before") + length("after") + length(body) + length(author) + length(created_at) + 80';

export async function addComment(
  env: Env,
  input: AddCommentInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  // Task, komentar, dan statistik batas komentar dalam satu round trip.
  const { loaded, stats } = await loadForWrite(
    env,
    input,
    `SELECT COUNT(*) AS n, COALESCE(SUM(${COMMENT_SIZE_SQL}), 0) AS s FROM handover_comments WHERE handover_id = ?`,
  );
  const handover = loaded.record;
  assertNotCancelled(handover);
  if ((stats?.n ?? 0) >= HANDOVER_LIMITS.comments) {
    const message = `Task ini sudah mencapai batas ${HANDOVER_LIMITS.comments} komentar`;
    throw appError('VALIDATION', message, { body: message });
  }
  const quote = handoverNormalizeAnchorText(input.quote);
  // Komentar umum (tanpa kutipan) tidak punya konteks jangkar.
  const anchor =
    quote === ''
      ? { quote, before: '', after: '' }
      : {
          quote,
          before: handoverNormalizeAnchorText(input.before),
          after: handoverNormalizeAnchorText(input.after),
        };
  // Kutipan kosong = komentar umum (tanpa seleksi); selainnya harus ditemukan pada catatan.
  if (anchor.quote !== '' && locateAnchor(noteToPlainText(handover.note), anchor) === null) {
    const message = 'Kutipan tidak ditemukan pada catatan';
    throw appError('VALIDATION', message, { quote: message });
  }
  const now = nowIso(env);
  const id = crypto.randomUUID();
  const newSize =
    id.length +
    anchor.quote.length +
    anchor.before.length +
    anchor.after.length +
    input.body.length +
    actor.email.length +
    now.length +
    80;
  if ((stats?.s ?? 0) + newSize + 2 > HANDOVER_LIMITS.stateJson) {
    const message = `Komentar tidak dapat ditambahkan: data komentar task ini sudah penuh (batas ${HANDOVER_LIMITS.comments} komentar atau 40.000 karakter, mana lebih dulu)`;
    throw appError('VALIDATION', message, { body: message });
  }
  const audit = fitAuditSnapshots(
    () => ({
      before: null,
      after: { number: handover.number, quote: anchor.quote, comment: input.body },
    }),
    false,
  );
  // Penjaga di batch yang sama: batas 50 komentar / 40.000 karakter dan status belum dibatalkan dihitung
  // ulang oleh SQL saat menulis, sehingga komentar serentak tidak melewati batas.
  try {
    await env.DB.batch([
      // Penjaga digabung ke kolom `id` (nilai gagal = `integer overflow`): tanpa pernyataan penjaga terpisah.
      env.DB.prepare(
        `INSERT INTO handover_comments (id, handover_id, author, created_at, quote, "before", "after", body) VALUES (CASE WHEN ((SELECT COUNT(*) FROM handover_comments WHERE handover_id = ?) < ? AND (SELECT COALESCE(SUM(${COMMENT_SIZE_SQL}), 0) FROM handover_comments WHERE handover_id = ?) + ? + 2 <= ? AND EXISTS (SELECT 1 FROM handovers WHERE id = ? AND status <> 'cancelled')) THEN ? ELSE ${CAS_FAIL_SQL} END, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        handover.id,
        HANDOVER_LIMITS.comments,
        handover.id,
        newSize,
        HANDOVER_LIMITS.stateJson,
        handover.id,
        id,
        handover.id,
        actor.email,
        now,
        anchor.quote,
        anchor.before,
        anchor.after,
        input.body,
      ),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'handover.comment',
        target: handover.number,
        before: null,
        after: audit.after,
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /integer overflow/i.test(error.message)) {
      throw appError(
        'VALIDATION',
        `Komentar tidak dapat ditambahkan: batas ${HANDOVER_LIMITS.comments} komentar atau 40.000 karakter tercapai, atau task sudah dibatalkan`,
        { body: 'Komentar tidak dapat ditambahkan' },
      );
    }
    throw error;
  }
  // Komentar tidak mengubah isi task: `updatedAt`/`version` tidak dinaikkan agar tidak memicu CONFLICT pada form WH.
  // Daftar komentar balasan = yang dimuat awal + komentar baru (paling akhir menurut waktu lalu rowid).
  const created: StoredComment = {
    id,
    quote: anchor.quote,
    before: anchor.before,
    after: anchor.after,
    body: input.body,
    author: actor.email,
    at: now,
  };
  return dtoOf(env, { ...loaded, comments: [...(loaded.comments ?? []), created] });
}

export async function cancelHandover(
  env: Env,
  input: HandoverRefInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  return runCas(async () => {
    const { loaded } = await loadForWrite(env, input);
    const handover = loaded.record;
    const status = deriveHandoverStatus(handover.status, progressOf(handover));
    if (status === 'cancelled') return dtoOf(env, loaded);
    if (status === 'done') {
      throw appError('CONFLICT', 'Task yang sudah selesai tidak dapat dibatalkan');
    }
    const saved = await writeTaskChange(
      env,
      loaded,
      { status: 'cancelled' },
      'handover.cancel',
      actor,
      nowIso(env),
    );
    return toDtoAfter(saved, loaded);
  }, STALE_MESSAGE);
}

/** Membuka kembali task Dibatalkan: status tersimpan kembali `open`; centang yang ada tidak berubah. */
export async function reopenHandover(
  env: Env,
  input: HandoverRefInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  return runCas(async () => {
    const { loaded } = await loadForWrite(env, input);
    if (loaded.record.status !== 'cancelled') {
      throw appError('CONFLICT', 'Hanya task yang dibatalkan yang dapat dibuka kembali');
    }
    const saved = await writeTaskChange(
      env,
      loaded,
      { status: 'open' },
      'handover.uncancel',
      actor,
      nowIso(env),
    );
    return toDtoAfter(saved, loaded);
  }, STALE_MESSAGE);
}
