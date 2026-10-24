import type { UserContext } from '@worker/modules/access/context';
import { loadUserContext } from '@worker/modules/access/context';
import type { Env } from './env';

/** Konteks permintaan RPC: env, pengguna beserta izinnya, dan lokasi tervalidasi (rute berlokasi). */
export interface RequestCtx {
  env: Env;
  requestId: string;
  user: UserContext;
  /** Lokasi tervalidasi untuk rute berlokasi; kosong untuk rute global. */
  locationIds: string[];
}

/** Pelaku perubahan data: user web (`UserContext` memenuhinya) atau pelaku sinkron `sync:desktop`. */
export interface ActorRef {
  email: string;
}

/**
 * Muat konteks akses (satu `batch` D1, tanpa cache lintas permintaan). `locationIds` diisi router
 * setelah izin lokasi diperiksa.
 */
export async function loadRequestCtx(
  env: Env,
  email: string,
  requestId = '',
): Promise<RequestCtx | null> {
  const user = await loadUserContext(env, email);
  return user ? { env, requestId, user, locationIds: [] } : null;
}
