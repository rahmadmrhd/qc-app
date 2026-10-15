import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { customerKey } from '@shared/handover';
import type { CustomerDto, RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';
import type { CustomerRecord, NewCustomerRecord } from './repo';
import { insertCustomer_, listCustomers_, updateCustomer_ } from './repo';

function toCustomerDto_(customer: NewCustomerRecord): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    updatedAt: customer.updatedAt,
  };
}

export function customerSnapshot_(customer: NewCustomerRecord): Record<string, unknown> {
  return { name: customer.name, status: customer.status };
}

export function listCustomerDtos_(): CustomerDto[] {
  return listCustomers_()
    .map(toCustomerDto_)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mencari customer menurut nama (kunci ternormalisasi; ejaan resmi yang tersimpan menang); bila belum ada,
 * membuatnya dan mencatat audit — inilah "buat langsung saat mengetik" (FC2). Customer nonaktif ditolak
 * kecuali `currentId` (task yang sudah memakainya). PEMANGGIL WAJIB memegang lock (tidak mengunci sendiri).
 */
export function resolveCustomerByName_(
  name: string,
  actor: ActorRef,
  currentId?: string,
): NewCustomerRecord {
  const key = customerKey(name);
  const found = listCustomers_().find((customer) => customer.key === key);
  if (found) {
    if (found.status === 'inactive' && found.id !== currentId) {
      const message = 'Customer dinonaktifkan; aktifkan dulu di halaman Customer';
      throw appError_('VALIDATION', message, { customerName: message });
    }
    return found;
  }
  const now = nowIso_();
  const created: NewCustomerRecord = {
    id: platform_().uuid(),
    name,
    key,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  insertCustomer_(created);
  appendAudit_({
    ts: now,
    actor: actor.email,
    action: 'customer.create',
    target: created.name,
    before: null,
    after: customerSnapshot_(created),
  });
  return created;
}

export function renameCustomer_(input: RenameCustomerInput, actor: ActorRef): CustomerDto {
  return platform_().withLock(() => {
    const customers = listCustomers_();
    const existing = customers.find((customer) => customer.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Customer tidak ditemukan');
    const key = customerKey(input.name);
    if (customers.some((customer) => customer.id !== input.id && customer.key === key)) {
      throw appError_('CONFLICT', 'Nama customer sudah dipakai', {
        name: 'Nama customer sudah dipakai',
      });
    }
    if (existing.name === input.name) return toCustomerDto_(existing);
    const now = nowIso_();
    const updated: CustomerRecord = {
      ...existing,
      name: input.name,
      key,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateCustomer_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'customer.rename',
      target: updated.name,
      before: customerSnapshot_(existing),
      after: customerSnapshot_(updated),
    });
    return toCustomerDto_(updated);
  });
}

export function setCustomerStatus_(input: SetCustomerStatusInput, actor: ActorRef): CustomerDto {
  return platform_().withLock(() => {
    const existing = listCustomers_().find((customer) => customer.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Customer tidak ditemukan');
    if (existing.status === input.status) return toCustomerDto_(existing);
    const now = nowIso_();
    const updated: CustomerRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateCustomer_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'customer.activate' : 'customer.deactivate',
      target: updated.name,
      before: customerSnapshot_(existing),
      after: customerSnapshot_(updated),
    });
    return toCustomerDto_(updated);
  });
}
