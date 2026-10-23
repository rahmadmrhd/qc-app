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
import {
  extractChecklist,
  matchChecks,
  normalizeNoteChecks,
  reconcileChecks,
} from '@shared/handover-checklist';
import { locateAnchor, noteToPlainText } from '@shared/handover-comments';
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
      stale:
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

/** Snapshot audit: butir tercentang sebagai daftar teks agar diff audit membandingkan per butir. */
export function handoverSnapshot_(
  handover: NewHandoverRecord,
  customerName: string,
  locationNames: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    number: handover.number,
    location: locationNames.get(handover.locationId) ?? handover.locationId,
    customer: customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, progressOf_(handover)),
    checked: matchChecks(handover.note, handover.checks)
      .filter((check) => check !== null)
      .map((check) => check?.text ?? ''),
  };
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
      insertHandover_(created);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: created.number,
        before: null,
        after: handoverSnapshot_(created, created.customerName, locationNames),
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
    const before = handoverSnapshot_(loaded, currentCustomerName, locationNames);
    const after = {
      ...handoverSnapshot_(next, next.customerName, locationNames),
      ...(resets.length > 0 ? { resets } : {}),
    };
    const saved: HandoverRecord = { ...next, updatedAt: now, updatedBy: actor.email };
    updateHandover_(saved);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.update',
      target: loaded.number,
      before,
      after,
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
      if (note.length > HANDOVER_LIMITS.note) {
        fail('note', `Catatan maksimal ${HANDOVER_LIMITS.note} karakter`);
      }
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
      insertHandover_(record);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: record.number,
        before: null,
        after: handoverSnapshot_(record, record.customerName, locationNames),
      });
      created.push(record);
    }
    return created.map((record) => toHandoverDto_(record, names));
  });
}

// --- Rangka sementara (diisi Task 5) ---
function notImplemented_(): never {
  throw appError_('INTERNAL', 'belum diimplementasi');
}

export function setCheck_(_input: SetCheckInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function setDone_(_input: SetDoneInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function addComment_(_input: AddCommentInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function cancelHandover_(_input: HandoverRefInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}
