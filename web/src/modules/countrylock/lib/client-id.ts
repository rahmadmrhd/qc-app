import { newUuid } from '@/lib/uuid';

/** Id idempoten per baris (`serials.client_id`): UUID v4 (`newUuid`, termasuk cadangan tanpa `randomUUID`). */
export function newClientId(): string {
  return newUuid();
}
