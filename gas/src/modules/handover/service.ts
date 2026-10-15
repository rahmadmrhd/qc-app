import { appError_ } from '@gas/core/errors';
import { listLocations_ } from '@gas/modules/access/repo';
import { listCustomers_ } from '@gas/modules/customer/repo';
import { listItems_ } from '@gas/modules/item/repo';
import { brandNameMap_ } from '@gas/modules/item/service';
import { deriveHandoverStatus, progressTotals } from '@shared/handover';
import type {
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverSummaryDto,
} from '@shared/rpc';
import type { HandoverLineRecord, HandoverRecord } from './repo';
import { listHandoverLines_, listHandovers_ } from './repo';

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
