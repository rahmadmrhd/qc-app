import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_, listLocations_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { listCustomers_ } from '@gas/modules/customer/repo';
import { resolveCustomerByName_ } from '@gas/modules/customer/service';
import { listItems_ } from '@gas/modules/item/repo';
import { brandNameMap_ } from '@gas/modules/item/service';
import {
  dateKeyOf,
  deriveHandoverStatus,
  handoverNumber,
  nextHandoverSequence,
  progressTotals,
} from '@shared/handover';
import type {
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverRefInput,
  HandoverSummaryDto,
  SaveHandoverInput,
} from '@shared/rpc';
import type { HandoverLineRecord, HandoverRecord, NewHandoverLineRecord } from './repo';
import {
  deleteHandoverLine_,
  insertHandover_,
  insertHandoverLine_,
  listHandoverLines_,
  listHandovers_,
  updateHandover_,
  updateHandoverLine_,
} from './repo';

/** Nama customer terkini menurut id (salinan pada task dipakai bila customer tidak ada). */
export function customerNameMap_(): Map<string, string> {
  return new Map(listCustomers_().map((customer) => [customer.id, customer.name]));
}

export function locationNameMap_(): Map<string, string> {
  return new Map(listLocations_().map((location) => [location.id, location.name]));
}

function toHandoverSummaryDto_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
  customerNames: ReadonlyMap<string, string>,
): HandoverSummaryDto {
  const totals = progressTotals(lines);
  return {
    id: handover.id,
    number: handover.number,
    locationId: handover.locationId,
    customerId: handover.customerId,
    customerName: customerNames.get(handover.customerId) ?? handover.customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, lines),
    lineCount: lines.length,
    doneUnits: totals.done,
    totalUnits: totals.total,
    createdAt: handover.createdAt,
    updatedAt: handover.updatedAt,
  };
}

export function toHandoverDto_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
  customerNames: ReadonlyMap<string, string>,
): HandoverDto {
  return {
    ...toHandoverSummaryDto_(handover, lines, customerNames),
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemLabel: line.itemLabel,
      qty: line.qty,
      doneQty: line.doneQty,
      doneAt: line.doneAt,
      doneBy: line.doneBy,
    })),
    createdBy: handover.createdBy,
    updatedBy: handover.updatedBy,
  };
}

function linesByHandover_(): Map<string, HandoverLineRecord[]> {
  const grouped = new Map<string, HandoverLineRecord[]>();
  for (const line of listHandoverLines_()) {
    const list = grouped.get(line.handoverId) ?? [];
    list.push(line);
    grouped.set(line.handoverId, list);
  }
  return grouped;
}

/** Task di lokasi yang diizinkan (`locationIds` dari `ctx`), terbaru dulu. */
export function listHandoverSummaries_(locationIds: readonly string[]): HandoverSummaryDto[] {
  const grouped = linesByHandover_();
  const names = customerNameMap_();
  return listHandovers_()
    .filter((handover) => locationIds.includes(handover.locationId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
    .map((handover) => toHandoverSummaryDto_(handover, grouped.get(handover.id) ?? [], names));
}

/**
 * Detail satu task. Lokasi baris task HARUS salah satu `locationIds` yang diizinkan router; bila tidak
 * (task milik lokasi lain), `NOT_FOUND` — izin ditegakkan di lokasi baris, bukan lokasi yang diklaim klien.
 */
export function getHandoverDto_(
  input: GetHandoverInput,
  locationIds: readonly string[],
): HandoverDto {
  const handover = listHandovers_().find((row) => row.id === input.id);
  if (!handover || !locationIds.includes(handover.locationId)) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  const lines = listHandoverLines_().filter((line) => line.handoverId === handover.id);
  return toHandoverDto_(handover, lines, customerNameMap_());
}

/** Item dan customer aktif untuk saran di form task (diambil lewat izin serah terima, bukan izin item). */
export function handoverOptions_(): HandoverOptionsDto {
  const brands = brandNameMap_();
  return {
    items: listItems_()
      .filter((item) => item.status === 'active')
      .map((item) => ({
        id: item.id,
        brand: brands.get(item.brandId) ?? '',
        model: item.model,
        aliases: [...item.aliases],
      }))
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model)),
    customers: listCustomers_()
      .filter((customer) => customer.status === 'active')
      .map((customer) => ({ id: customer.id, name: customer.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

interface SnapshotHandover {
  number: string;
  locationId: string;
  customerName: string;
  note: string;
  status: HandoverRecord['status'];
}

/** Snapshot audit: daftar baris sebagai teks per entri agar diff audit membandingkan per baris. */
export function handoverSnapshot_(
  handover: SnapshotHandover,
  lines: ReadonlyArray<{ itemLabel: string; qty: number; doneQty: number }>,
  locationNames: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    number: handover.number,
    location: locationNames.get(handover.locationId) ?? handover.locationId,
    customer: handover.customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, lines),
    lines: lines.map(
      (line) =>
        `${line.itemLabel} × ${line.qty}${line.doneQty > 0 ? ` (selesai ${line.doneQty})` : ''}`,
    ),
  };
}

/**
 * Memuat task untuk ditulis. `NOT_FOUND` bila id tak ada ATAU lokasinya bukan `locationId` yang sudah diizinkan
 * router (izin ditegakkan lagi di lokasi baris). PEMANGGIL WAJIB memegang lock.
 */
export function loadHandoverForWrite_(ref: HandoverRefInput): {
  handover: HandoverRecord;
  lines: HandoverLineRecord[];
} {
  const handover = listHandovers_().find((row) => row.id === ref.id);
  if (!handover || handover.locationId !== ref.locationId) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  const lines = listHandoverLines_().filter((line) => line.handoverId === handover.id);
  return { handover, lines };
}

/** Task Selesai/Dibatalkan tidak dapat diubah (WH maupun QC). */
export function assertHandoverOpen_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
): void {
  const status = deriveHandoverStatus(handover.status, lines);
  if (status === 'cancelled') {
    throw appError_('CONFLICT', 'Task sudah dibatalkan dan tidak dapat diubah');
  }
  if (status === 'done') {
    throw appError_('CONFLICT', 'Task sudah selesai dan tidak dapat diubah');
  }
}

function lineError_(message: string): never {
  throw appError_('VALIDATION', message, { lines: message });
}

export function saveHandover_(input: SaveHandoverInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const loaded = input.id
      ? loadHandoverForWrite_({ id: input.id, locationId: input.locationId })
      : null;
    if (loaded) assertHandoverOpen_(loaded.handover, loaded.lines);
    const existingLines = loaded?.lines ?? [];
    const items = new Map(listItems_().map((item) => [item.id, item]));
    const brands = brandNameMap_();
    const label = (itemId: string): string => {
      const item = items.get(itemId);
      return item ? `${brands.get(item.brandId) ?? ''} ${item.model}`.trim() : itemId;
    };

    // Validasi baris SEBELUM menulis apa pun (termasuk membuat customer).
    const byItem = new Map(existingLines.map((line) => [line.itemId, line]));
    input.lines.forEach((line, index) => {
      const item = items.get(line.itemId);
      if (!item) lineError_(`Baris ${index + 1}: tipe tidak ditemukan`);
      const current = byItem.get(line.itemId);
      if (!current && item.status !== 'active') {
        lineError_(`Baris ${index + 1}: tipe ${label(line.itemId)} dinonaktifkan`);
      }
      if (current && line.qty < current.doneQty) {
        lineError_(
          `${current.itemLabel}: qty target tidak boleh di bawah qty selesai (${current.doneQty})`,
        );
      }
    });
    const wanted = new Set(input.lines.map((line) => line.itemId));
    for (const current of existingLines) {
      if (!wanted.has(current.itemId) && current.doneQty > 0) {
        lineError_(`${current.itemLabel} sudah ada progres dan tidak dapat dihapus`);
      }
    }

    const customer = resolveCustomerByName_(input.customerName, actor, loaded?.handover.customerId);
    const locationNames = locationNameMap_();
    const now = nowIso_();

    if (!loaded) {
      const handovers = listHandovers_();
      const sequence = nextHandoverSequence(
        handovers.map((row) => row.number),
        dateKeyOf(platform_().now()),
      );
      const created = {
        id: platform_().uuid(),
        number: handoverNumber(dateKeyOf(platform_().now()), sequence),
        locationId: input.locationId,
        customerId: customer.id,
        customerName: customer.name,
        note: input.note,
        status: 'open' as const,
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
      };
      insertHandover_(created);
      const lines: NewHandoverLineRecord[] = input.lines.map((line) => ({
        id: platform_().uuid(),
        handoverId: created.id,
        itemId: line.itemId,
        itemLabel: label(line.itemId),
        qty: line.qty,
        doneQty: 0,
        doneAt: '',
        doneBy: '',
      }));
      for (const line of lines) insertHandoverLine_(line);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: created.number,
        before: null,
        after: handoverSnapshot_(created, lines, locationNames),
      });
      return toHandoverDto_(
        { ...created, rowNumber: 0 },
        lines.map((line) => ({ ...line, rowNumber: 0 })),
        customerNameMap_(),
      );
    }

    const { handover, lines: oldLines } = loaded;
    const before = handoverSnapshot_(handover, oldLines, locationNames);
    // Hitung hasil akhir baris (tanpa menulis) untuk mendeteksi "tidak ada perubahan".
    const nextLines = input.lines.map((line) => {
      const current = byItem.get(line.itemId);
      return {
        itemId: line.itemId,
        itemLabel: current?.itemLabel ?? label(line.itemId),
        qty: line.qty,
        doneQty: current?.doneQty ?? 0,
      };
    });
    const nextHandover = {
      ...handover,
      customerId: customer.id,
      customerName: customer.name,
      note: input.note,
    };
    const after = handoverSnapshot_(nextHandover, nextLines, locationNames);
    if (JSON.stringify(before) === JSON.stringify(after) && customer.id === handover.customerId) {
      return toHandoverDto_(handover, oldLines, customerNameMap_());
    }

    updateHandover_({ ...nextHandover, updatedAt: now, updatedBy: actor.email });
    for (const line of input.lines) {
      const current = byItem.get(line.itemId);
      if (current) {
        if (current.qty !== line.qty) updateHandoverLine_({ ...current, qty: line.qty });
      } else {
        insertHandoverLine_({
          id: platform_().uuid(),
          handoverId: handover.id,
          itemId: line.itemId,
          itemLabel: label(line.itemId),
          qty: line.qty,
          doneQty: 0,
          doneAt: '',
          doneBy: '',
        });
      }
    }
    // Hapus dari nomor baris TERBESAR ke terkecil (nomor di bawahnya bergeser setelah tiap hapus).
    for (const removed of oldLines
      .filter((line) => !wanted.has(line.itemId))
      .sort((a, b) => b.rowNumber - a.rowNumber)) {
      deleteHandoverLine_(removed);
    }
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.update',
      target: handover.number,
      before,
      after,
    });
    const fresh = loadHandoverForWrite_({ id: handover.id, locationId: handover.locationId });
    return toHandoverDto_(fresh.handover, fresh.lines, customerNameMap_());
  });
}

export function cancelHandover_(input: HandoverRefInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const { handover, lines } = loadHandoverForWrite_(input);
    const status = deriveHandoverStatus(handover.status, lines);
    if (status === 'cancelled') return toHandoverDto_(handover, lines, customerNameMap_());
    if (status === 'done') {
      throw appError_('CONFLICT', 'Task yang sudah selesai tidak dapat dibatalkan');
    }
    const now = nowIso_();
    const updated: HandoverRecord = {
      ...handover,
      status: 'cancelled',
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateHandover_(updated);
    const names = locationNameMap_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.cancel',
      target: handover.number,
      before: handoverSnapshot_(handover, lines, names),
      after: handoverSnapshot_(updated, lines, names),
    });
    return toHandoverDto_(updated, lines, customerNameMap_());
  });
}
