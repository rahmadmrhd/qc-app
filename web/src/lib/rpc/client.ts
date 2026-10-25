import type {
  WorkerRpcInput as RpcInput,
  WorkerRpcMethod as RpcMethod,
  WorkerRpcOutput as RpcOutput,
  RpcResult,
} from '@shared/rpc';
import { RpcError } from './rpc-error';
import type { RpcTransport } from './transport';

export type RpcCall = <M extends RpcMethod>(method: M, input: RpcInput<M>) => Promise<RpcOutput<M>>;

function isRpcResult(value: unknown): value is RpcResult<unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

export function createRpcClient(transport: RpcTransport, getToken: () => string | null): RpcCall {
  async function call<M extends RpcMethod>(method: M, input: RpcInput<M>): Promise<RpcOutput<M>> {
    let raw: string;
    try {
      raw = await transport.call(method, JSON.stringify(input ?? null), getToken() ?? '');
    } catch (error) {
      throw new RpcError(
        'INTERNAL',
        'Tidak dapat menghubungi server. Periksa koneksi Anda.',
        '-',
        undefined,
        { cause: error },
      );
    }
    let result: unknown;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new RpcError('INTERNAL', 'Respons server tidak valid', '-');
    }
    if (!isRpcResult(result)) throw new RpcError('INTERNAL', 'Respons server tidak valid', '-');
    if (!result.ok) {
      throw new RpcError(
        result.error.code,
        result.error.message,
        result.error.requestId,
        result.error.fields,
      );
    }
    return result.data as RpcOutput<M>;
  }
  return call;
}
