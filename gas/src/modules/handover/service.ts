import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_, listLocations_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { listCustomers_ } from '@gas/modules/customer/repo';
import { resolveCustomerByName_ } from '@gas/modules/customer/service';
import {
  customerKey,
  dateKeyOf,
  deriveHandoverStatus,
  HANDOVER_LIMITS,
  handoverNumber,
  nextHandoverSequence,
} from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import {
  extractChecklist,
  matchChecks,
  normalizeNoteChecks,
  reconcileChecks,
} from '@shared/handover-checklist';
import {
  handoverNormalizeAnchorText,
  locateAnchor,
  noteToPlainText,
} from '@shared/handover-comments';
import { handoverCanonicalText } from '@shared/handover-text';
import type {
  AddCommentInput,
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverRefInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/rpc';
import type { HandoverRecord, NewHandoverRecord } from './repo';
import { insertHandover_, listHandovers_, updateHandover_ } from './repo';
import { handoverNoteError_ } from './validate';

/** Nama customer terkini menurut id (salinan pada task dipakai bila customer tidak ada). */
export function customerNameMap_(): Map<string, string> {
  return new Map(listCustomers_().map((customer) => [customer.id, customer.name]));
}

export function locationNameMap_(): Map<string, string> {
  return new Map(listLocations_().map((location) => [location.id, location.name]));
}

/** Progres checklist dari catatan dan centang tersimpan. */
function progressOf_(handover: NewHandoverRecord): {
  total: number;
  done: number;
  completed: boolean;
} {
  const matched = matchChecks(handover.note, handover.checks);
  return {
    total: matched.length,
    done: matched.filter((check) => check !== null).length,
    completed: handover.completedAt !== '',
  };
}

export function toHandoverDto_(
  handover: NewHandoverRecord,
  customerNames: ReadonlyMap<string, string>,
): HandoverDto {
  const entries = extractChecklist(handover.note);
  const matched = matchChecks(handover.note, handover.checks);
  const plain = noteToPlainText(handover.note);
  return {
    id: handover.id,
    number: handover.number,
    locationId: handover.locationId,
    customerId: handover.customerId,
    customerName: customerNames.get(handover.customerId) ?? handover.customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, progressOf_(handover)),
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
    comments: handover.comments.map((comment) => ({
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

/** Seluruh task di lokasi yang diizinkan dalam SATU pembacaan tabel, terbaru dahulu. */
export function handoverBoard_(locationIds: readonly string[]): HandoverDto[] {
  const names = customerNameMap_();
  return listHandovers_()
    .filter((handover) => locationIds.includes(handover.locationId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
    .map((handover) => toHandoverDto_(handover, names));
}

/**
 * Detail satu task. Lokasi baris task HARUS salah satu lokasi yang diizinkan router (`locationIds` dari `ctx`);
 * bila tidak, `NOT_FOUND` — izin ditegakkan di lokasi baris, bukan lokasi yang diklaim klien.
 */
export function getHandoverDto_(
  input: GetHandoverInput,
  locationIds: readonly string[] = input.locationIds,
): HandoverDto {
  const handover = listHandovers_().find((row) => row.id === input.id);
  if (!handover || !locationIds.includes(handover.locationId)) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  return toHandoverDto_(handover, customerNameMap_());
}

/** Customer aktif untuk saran di form task (diambil lewat izin serah terima, bukan izin customer). */
export function handoverOptions_(): HandoverOptionsDto {
  const customers = listCustomers_();
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

/** Batas JSON per sel audit (before/after), sama dengan konvensi sel proyek. */
const AUDIT_MAX_JSON = HANDOVER_LIMITS.stateJson;
/** Panjang catatan di snapshot audit save yang terlalu besar, berurutan dari yang longgar. */
const AUDIT_NOTE_STEPS = [2000, 400, 0] as const;
const AUDIT_TRUNCATED = ' (dipotong)';

/**
 * Snapshot audit: butir tercentang sebagai daftar teks agar diff audit membandingkan per butir. `note` hanya
 * dimuat bila `noteLimit` diberikan (aksi yang mengubah catatan), dipotong dengan penanda "(dipotong)".
 */
export function handoverSnapshot_(
  handover: NewHandoverRecord,
  customerName: string,
  locationNames: ReadonlyMap<string, string>,
  noteLimit: number | null = null,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    number: handover.number,
    location: locationNames.get(handover.locationId) ?? handover.locationId,
    customer: customerName,
    status: deriveHandoverStatus(handover.status, progressOf_(handover)),
    checked: matchChecks(handover.note, handover.checks)
      .filter((check) => check !== null)
      .map((check) => check?.text ?? ''),
  };
  if (noteLimit !== null) {
    snapshot.note =
      handover.note.length > noteLimit
        ? `${handover.note.slice(0, noteLimit)}${AUDIT_TRUNCATED}`
        : handover.note;
  }
  return snapshot;
}

/**
 * Menyusun pasangan snapshot audit yang muat di satu sel (JSON <= 40.000 karakter) SEBELUM baris task ditulis.
 * Aksi yang mengubah catatan (`withNote`) memuat catatan, dipotong bila perlu; bila tetap tidak muat,
 * VALIDATION jelas (tidak ada yang tertulis).
 */
export function fitAuditSnapshots_(
  build: (noteLimit: number | null) => {
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  },
  withNote: boolean,
): { before: Record<string, unknown> | null; after: Record<string, unknown> } {
  const limits: Array<number | null> = withNote ? [...AUDIT_NOTE_STEPS] : [null];
  for (const limit of limits) {
    const pair = build(limit);
    if (
      JSON.stringify(pair.after).length <= AUDIT_MAX_JSON &&
      (pair.before === null || JSON.stringify(pair.before).length <= AUDIT_MAX_JSON)
    ) {
      return pair;
    }
  }
  const message = 'Perubahan terlalu besar untuk dicatat di audit; persingkat catatan';
  throw appError_('VALIDATION', message, { note: message });
}

/**
 * Memuat task untuk ditulis. `NOT_FOUND` bila id tak ada ATAU lokasinya bukan `locationId` yang sudah diizinkan
 * router (izin ditegakkan lagi di lokasi baris). PEMANGGIL WAJIB memegang lock.
 */
export function loadHandoverForWrite_(ref: HandoverRefInput): HandoverRecord {
  const handover = listHandovers_().find((row) => row.id === ref.id);
  if (!handover || handover.locationId !== ref.locationId) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  return handover;
}

/** Hanya task Dibatalkan yang terkunci (WH maupun QC). */
export function assertHandoverNotCancelled_(handover: HandoverRecord): void {
  if (handover.status === 'cancelled') {
    throw appError_('CONFLICT', 'Task sudah dibatalkan dan tidak dapat diubah');
  }
}

export function saveHandover_(input: SaveHandoverInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const loaded = input.id
      ? loadHandoverForWrite_({ id: input.id, locationId: input.locationId })
      : null;
    if (loaded) assertHandoverNotCancelled_(loaded);
    if (loaded && input.expectedUpdatedAt && input.expectedUpdatedAt !== loaded.updatedAt) {
      throw appError_(
        'CONFLICT',
        'Task sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda',
      );
    }
    // Centang hanya milik QC: "- [x]" dari penulis catatan dinormalkan.
    const note = normalizeNoteChecks(input.note);
    const noteError = handoverNoteError_(note);
    if (noteError !== null) throw appError_('VALIDATION', noteError, { note: noteError });

    // Validasi centang SEBELUM menulis apa pun (termasuk membuat customer).
    const reconciled = loaded ? reconcileChecks(loaded.note, loaded.checks, note) : null;
    if (reconciled && reconciled.removed.length > 0) {
      const message = `Butir yang sudah dicentang tidak dapat dihapus: ${reconciled.removed.join('; ')}`;
      throw appError_('VALIDATION', message, { note: message });
    }

    // Customer opsional: nama kosong = tanpa customer (tidak ada yang dibuat).
    const customer =
      input.customerName === ''
        ? null
        : resolveCustomerByName_(input.customerName, actor, loaded?.customerId);
    const locationNames = locationNameMap_();
    const now = nowIso_();

    if (!loaded) {
      const dateKey = dateKeyOf(platform_().now());
      const sequence = nextHandoverSequence(
        listHandovers_().map((row) => row.number),
        dateKey,
      );
      const created: NewHandoverRecord = {
        id: platform_().uuid(),
        number: handoverNumber(dateKey, sequence),
        locationId: input.locationId,
        customerId: customer?.id ?? '',
        customerName: customer?.name ?? '',
        note,
        status: 'open',
        checks: [],
        comments: [],
        completedAt: '',
        completedBy: '',
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
      };
      // Audit disusun dan diperiksa mutlak SEBELUM baris task ditulis.
      const audit = fitAuditSnapshots_(
        (limit) => ({
          before: null,
          after: handoverSnapshot_(created, created.customerName, locationNames, limit),
        }),
        true,
      );
      insertHandover_(created);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: created.number,
        before: null,
        after: audit.after,
      });
      return toHandoverDto_(created, customerNameMap_());
    }

    // Nama customer terkini (bukan salinan lama): ganti nama customer saja bukan perubahan task.
    const currentCustomerName = customerNameMap_().get(loaded.customerId) ?? loaded.customerName;
    const next: HandoverRecord = {
      ...loaded,
      customerId: customer?.id ?? '',
      customerName: customer?.name ?? '',
      note,
      checks: reconciled?.checks ?? loaded.checks,
    };
    if (
      next.note === loaded.note &&
      next.customerId === loaded.customerId &&
      (customer?.name ?? '') === currentCustomerName
    ) {
      return toHandoverDto_(loaded, customerNameMap_());
    }
    const resets = (reconciled?.resets ?? []).map((reset) => `${reset.from} → ${reset.to}`);
    const audit = fitAuditSnapshots_(
      (limit) => ({
        before: handoverSnapshot_(loaded, currentCustomerName, locationNames, limit),
        after: {
          ...handoverSnapshot_(next, next.customerName, locationNames, limit),
          ...(resets.length > 0 ? { resets } : {}),
        },
      }),
      true,
    );
    const saved: HandoverRecord = { ...next, updatedAt: now, updatedBy: actor.email };
    updateHandover_(saved);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.update',
      target: loaded.number,
      before: audit.before,
      after: audit.after,
    });
    return toHandoverDto_(saved, customerNameMap_());
  });
}

/**
 * Simpan banyak task atomik: SEMUA task divalidasi lebih dulu (batas, customer nonaktif); baru dalam satu lock
 * nomor dialokasikan berurutan dan task ditulis. Galat sebelum penulisan = tidak ada task, customer, atau
 * nomor yang terpakai. Customer baru dibuat sekali per `customerKey` yang sama (pembacaan tabel customer
 * mencerminkan penulisan sebelumnya dalam permintaan yang sama).
 */
export function saveHandoverBatch_(input: SaveHandoverBatchInput, actor: ActorRef): HandoverDto[] {
  return platform_().withLock(() => {
    if (input.tasks.length === 0 || input.tasks.length > HANDOVER_LIMITS.batch) {
      const message = `Jumlah task harus 1–${HANDOVER_LIMITS.batch}`;
      throw appError_('VALIDATION', message, { tasks: message });
    }
    const customers = listCustomers_();
    const prepared = input.tasks.map((task, index) => {
      const fail = (field: string, message: string): never => {
        throw appError_('VALIDATION', `Task ${index + 1}: ${message}`, {
          tasks: `Task ${index + 1}: ${message}`,
          [field]: message,
        });
      };
      const customerName = task.customerName.trim();
      const note = normalizeNoteChecks(task.note.trim());
      const noteError = handoverNoteError_(note);
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

    const locationNames = locationNameMap_();
    const dateKey = dateKeyOf(platform_().now());
    const numbers = listHandovers_().map((row) => row.number);
    let sequence = nextHandoverSequence(numbers, dateKey);
    const names = new Map<string, string>();
    const created: NewHandoverRecord[] = [];
    for (const task of prepared) {
      const customer =
        task.customerName === '' ? null : resolveCustomerByName_(task.customerName, actor);
      if (customer) names.set(customer.id, customer.name);
      const now = nowIso_();
      const record: NewHandoverRecord = {
        id: platform_().uuid(),
        number: handoverNumber(dateKey, sequence),
        locationId: input.locationId,
        customerId: customer?.id ?? '',
        customerName: customer?.name ?? '',
        note: task.note,
        status: 'open',
        checks: [],
        comments: [],
        completedAt: '',
        completedBy: '',
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
      };
      sequence++;
      // Catatan <= 5.000 karakter tanpa karakter kontrol selalu muat di sel audit (diperiksa tetap).
      const audit = fitAuditSnapshots_(
        (limit) => ({
          before: null,
          after: handoverSnapshot_(record, record.customerName, locationNames, limit),
        }),
        true,
      );
      insertHandover_(record);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: record.number,
        before: null,
        after: audit.after,
      });
      created.push(record);
    }
    return created.map((record) => toHandoverDto_(record, names));
  });
}

/** Nomor kemunculan butir `index` di antara butir bertulisan sama (mulai 0). */
function occurrenceAt_(note: string, index: number): number {
  const entries = extractChecklist(note);
  const target = entries[index];
  if (!target) return 0;
  return entries.filter((entry) => entry.index < index && entry.text === target.text).length;
}

function assertStateSize_(checks: readonly CheckState[]): void {
  if (JSON.stringify(checks).length > HANDOVER_LIMITS.stateJson) {
    const message = 'Data centang terlalu besar';
    throw appError_('VALIDATION', message, { checks: message });
  }
}

/**
 * Menulis perubahan yang TIDAK mengubah catatan (centang/selesai/batal/buka) + audit; audit tanpa `note`
 * disusun dan diperiksa ukurannya SEBELUM baris ditulis. Dalam lock.
 */
function writeTaskChange_(
  handover: HandoverRecord,
  patch: Partial<Pick<HandoverRecord, 'checks' | 'completedAt' | 'completedBy' | 'status'>>,
  action: string,
  actor: ActorRef,
  now: string,
): HandoverRecord {
  const saved: HandoverRecord = { ...handover, ...patch, updatedAt: now, updatedBy: actor.email };
  assertStateSize_(saved.checks);
  const names = locationNameMap_();
  const customerName = customerNameMap_().get(handover.customerId) ?? handover.customerName;
  const audit = fitAuditSnapshots_(
    () => ({
      before: handoverSnapshot_(handover, customerName, names),
      after: handoverSnapshot_(saved, customerName, names),
    }),
    false,
  );
  updateHandover_(saved);
  appendAudit_({
    ts: now,
    actor: actor.email,
    action,
    target: handover.number,
    before: audit.before,
    after: audit.after,
  });
  return saved;
}

export function setCheck_(input: SetCheckInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const handover = loadHandoverForWrite_(input);
    assertHandoverNotCancelled_(handover);
    const entry = extractChecklist(handover.note)[input.index];
    // Penjaga: teks butir pada indeks harus sama dengan yang dilihat pengguna (catatan bisa berubah);
    // dibandingkan dalam bentuk kanonis (tanpa escape Markdown/entitas HTML).
    if (!entry || entry.text !== handoverCanonicalText(input.text)) {
      throw appError_('CONFLICT', 'Catatan berubah; muat ulang halaman lalu ulangi');
    }
    const occurrence = occurrenceAt_(handover.note, input.index);
    const existing = matchChecks(handover.note, handover.checks)[input.index] ?? null;
    if (input.checked === (existing !== null)) {
      return toHandoverDto_(handover, customerNameMap_());
    }
    const now = nowIso_();
    const checks = input.checked
      ? [...handover.checks, { text: entry.text, by: actor.email, at: now, occurrence }]
      : handover.checks.filter(
          (check) => !(check.text === entry.text && check.occurrence === occurrence),
        );
    const saved = writeTaskChange_(
      handover,
      { checks },
      input.checked ? 'handover.check' : 'handover.uncheck',
      actor,
      now,
    );
    return toHandoverDto_(saved, customerNameMap_());
  });
}

/** Menyelesaikan task: mencentang semua butir yang belum (task tanpa butir ditandai selesai). Tidak ada buka kembali. */
export function setDone_(input: SetDoneInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const handover = loadHandoverForWrite_(input);
    assertHandoverNotCancelled_(handover);
    const entries = extractChecklist(handover.note);
    const matched = matchChecks(handover.note, handover.checks);
    const now = nowIso_();
    const missing = entries.filter((entry) => matched[entry.index] === null);
    const needsMark = entries.length === 0 && handover.completedAt === '';
    if (missing.length === 0 && !needsMark) return toHandoverDto_(handover, customerNameMap_());
    const checks = [
      ...handover.checks,
      ...missing.map((entry) => ({
        text: entry.text,
        by: actor.email,
        at: now,
        occurrence: occurrenceAt_(handover.note, entry.index),
      })),
    ];
    const saved = writeTaskChange_(
      handover,
      entries.length === 0 ? { checks, completedAt: now, completedBy: actor.email } : { checks },
      'handover.done',
      actor,
      now,
    );
    return toHandoverDto_(saved, customerNameMap_());
  });
}

export function addComment_(input: AddCommentInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const handover = loadHandoverForWrite_(input);
    assertHandoverNotCancelled_(handover);
    if (handover.comments.length >= HANDOVER_LIMITS.comments) {
      const message = `Task ini sudah mencapai batas ${HANDOVER_LIMITS.comments} komentar`;
      throw appError_('VALIDATION', message, { body: message });
    }
    const anchor = {
      quote: handoverNormalizeAnchorText(input.quote),
      before: handoverNormalizeAnchorText(input.before),
      after: handoverNormalizeAnchorText(input.after),
    };
    // Kutipan kosong = komentar umum (tanpa seleksi); selainnya harus ditemukan pada catatan.
    if (anchor.quote !== '' && locateAnchor(noteToPlainText(handover.note), anchor) === null) {
      const message = 'Kutipan tidak ditemukan pada catatan';
      throw appError_('VALIDATION', message, { quote: message });
    }
    const now = nowIso_();
    const comments = [
      ...handover.comments,
      { id: platform_().uuid(), ...anchor, body: input.body, author: actor.email, at: now },
    ];
    if (JSON.stringify(comments).length > HANDOVER_LIMITS.stateJson) {
      const message = `Komentar tidak dapat ditambahkan: data komentar task ini sudah penuh (batas ${HANDOVER_LIMITS.comments} komentar atau 40.000 karakter, mana lebih dulu)`;
      throw appError_('VALIDATION', message, { body: message });
    }
    const audit = fitAuditSnapshots_(
      () => ({
        before: null,
        after: { number: handover.number, quote: anchor.quote, comment: input.body },
      }),
      false,
    );
    // Komentar tidak mengubah isi task: `updatedAt` tidak dinaikkan agar tidak memicu CONFLICT pada form WH.
    const saved: HandoverRecord = { ...handover, comments };
    updateHandover_(saved);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.comment',
      target: handover.number,
      before: null,
      after: audit.after,
    });
    return toHandoverDto_(saved, customerNameMap_());
  });
}

export function cancelHandover_(input: HandoverRefInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const handover = loadHandoverForWrite_(input);
    const status = deriveHandoverStatus(handover.status, progressOf_(handover));
    if (status === 'cancelled') return toHandoverDto_(handover, customerNameMap_());
    if (status === 'done') {
      throw appError_('CONFLICT', 'Task yang sudah selesai tidak dapat dibatalkan');
    }
    const saved = writeTaskChange_(
      handover,
      { status: 'cancelled' },
      'handover.cancel',
      actor,
      nowIso_(),
    );
    return toHandoverDto_(saved, customerNameMap_());
  });
}

/** Membuka kembali task Dibatalkan: status tersimpan kembali `open`; centang yang ada tidak berubah. */
export function reopenHandover_(input: HandoverRefInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const handover = loadHandoverForWrite_(input);
    if (handover.status !== 'cancelled') {
      throw appError_('CONFLICT', 'Hanya task yang dibatalkan yang dapat dibuka kembali');
    }
    const saved = writeTaskChange_(
      handover,
      { status: 'open' },
      'handover.uncancel',
      actor,
      nowIso_(),
    );
    return toHandoverDto_(saved, customerNameMap_());
  });
}
