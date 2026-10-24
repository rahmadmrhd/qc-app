import type { RpcMethod } from '@shared/rpc';
import { isReadOnly_ } from './config';
import { appError_ } from './errors';

export const READ_ONLY_MESSAGE = 'Aplikasi sedang dipindahkan; hanya baca';

/**
 * Klasifikasi tiap method RPC untuk bendera `READ_ONLY` (jendela migrasi). `Record<RpcMethod, ...>` membuat
 * typecheck gagal bila method baru belum diklasifikasikan; method tak dikenal diperlakukan sebagai tulis.
 */
export const RPC_ACCESS: Record<RpcMethod, 'read' | 'write'> = {
  'auth.me': 'read',
  'access.users.list': 'read',
  'access.users.save': 'write',
  'access.users.setStatus': 'write',
  'access.roles.list': 'read',
  'access.roles.save': 'write',
  'access.roles.delete': 'write',
  'access.audit.list': 'read',
  'access.locations.list': 'read',
  'access.locations.save': 'write',
  'access.locations.setStatus': 'write',
  'files.upload': 'write',
  'files.get': 'read',
  'brands.list': 'read',
  'brands.save': 'write',
  'brands.setStatus': 'write',
  'customers.list': 'read',
  'customers.rename': 'write',
  'customers.setStatus': 'write',
  'handovers.options': 'read',
  'handovers.board': 'read',
  'handovers.get': 'read',
  'handovers.save': 'write',
  'handovers.saveBatch': 'write',
  'handovers.cancel': 'write',
  'handovers.reopen': 'write',
  'handovers.setCheck': 'write',
  'handovers.setDone': 'write',
  'handovers.comment': 'write',
  'items.list': 'read',
  'items.get': 'read',
  'items.save': 'write',
  'items.setStatus': 'write',
  'qrcodes.list': 'read',
  'qrcodes.get': 'read',
  'qrcodes.save': 'write',
  'qrcodes.delete': 'write',
  'qrcodes.getDefaults': 'read',
  'qrcodes.savePreset': 'write',
  'qrcodes.deletePreset': 'write',
  'qrcodes.saveLogoLibrary': 'write',
  'qrcodes.uploadPdf': 'write',
  'qrcodes.cloneFromDrive': 'write',
  'qrcodes.export': 'write',
  'qrcodes.file': 'read',
};

/** Method sinkron yang hanya membaca; selain ini (mis. `sync.*.push`, method baru) dianggap tulis. */
export const SYNC_READ_METHODS: readonly string[] = [
  'sync.ping',
  'sync.file.get',
  'sync.brands.pull',
  'sync.items.pull',
];

function readOnlyError_() {
  return appError_('UNAVAILABLE', READ_ONLY_MESSAGE);
}

/** Melempar `UNAVAILABLE` bila `READ_ONLY=1` dan method RPC bukan baca. Tanpa properti: tidak berbuat apa-apa. */
export function assertRpcWritable_(method: string): void {
  if (!isReadOnly_()) return;
  if (
    Object.prototype.hasOwnProperty.call(RPC_ACCESS, method) &&
    RPC_ACCESS[method as RpcMethod] === 'read'
  ) {
    return;
  }
  throw readOnlyError_();
}

/** Sama untuk method sinkron QC Desktop. */
export function assertSyncWritable_(method: string): void {
  if (!isReadOnly_()) return;
  if (SYNC_READ_METHODS.includes(method)) return;
  throw readOnlyError_();
}
