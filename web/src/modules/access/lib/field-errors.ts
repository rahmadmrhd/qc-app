import { RpcError } from '@/lib/rpc/rpc-error';

/** Pesan per field dari galat server (mis. konflik kode/nama) agar bisa tampil di field terkait. */
export function pickFieldErrors<K extends string>(
  error: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  if (!(error instanceof RpcError)) return result;
  for (const key of keys) {
    const message = error.fields?.[key];
    if (message) result[key] = message;
  }
  return result;
}
