import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { resetDeviceDbForTests } from '@/lib/device-db';
import { resetOutboxForTests } from '@/modules/handover/lib/outbox';
import { resetOutboxChannelForTests } from '@/modules/handover/lib/outbox-channel';
import { resetSendingForTests } from '@/modules/handover/lib/outbox-status';

/** Menyiapkan lingkungan antrean untuk tes: IndexedDB palsu baru, salinan memori dan siaran direset, `localStorage` kosong. */
export function resetOutboxEnv(): void {
  resetOutboxForTests();
  resetOutboxChannelForTests();
  resetSendingForTests();
  resetDeviceDbForTests();
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
}
