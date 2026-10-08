import type { ErrorCode } from '@shared/rpc';

export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    requestId: string,
    fields?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RpcError';
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
  }
}
