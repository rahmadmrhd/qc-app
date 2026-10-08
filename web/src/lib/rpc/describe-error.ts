import { RpcError } from './rpc-error';

export function describeError(error: unknown): string {
  if (!(error instanceof RpcError)) return 'Terjadi kesalahan yang tidak terduga.';
  const details = error.fields ? Object.values(error.fields).filter(Boolean) : [];
  const base = details.length > 0 ? `${error.message}: ${details.join(', ')}` : error.message;
  return error.code === 'INTERNAL' && error.requestId !== '-'
    ? `${base} (kode: ${error.requestId})`
    : base;
}
