import type { Env } from '@server/core/env';
import type { SYNC_ACTOR } from '@shared/sync';

/** Konteks handler sinkron: TIDAK pernah memuat `UserContext` (FS3). */
export interface SyncContext {
  env: Env;
  requestId: string;
  actor: typeof SYNC_ACTOR;
}

export interface SyncRouteDef<I = unknown> {
  validate: (raw: unknown) => I;
  handler: (input: I, ctx: SyncContext) => unknown | Promise<unknown>;
}
export type SyncRouteTable = Record<string, SyncRouteDef<unknown>>;

/** Menghapus tipe input agar rute bertipe berbeda dapat berbagi satu tabel. */
export function syncRoute<I>(def: SyncRouteDef<I>): SyncRouteDef<unknown> {
  return { validate: def.validate, handler: (input, ctx) => def.handler(input as I, ctx) };
}
