import { bridgeError_ } from './errors';

export type BridgePayload = Record<string, unknown>;

export function asBridgePayload_(value: unknown): BridgePayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw bridgeError_('VALIDATION', 'Payload harus berupa objek');
  }
  return value as BridgePayload;
}

export function reqText_(payload: BridgePayload, key: string, maxChars: number): string {
  const value = payload[key];
  if (typeof value !== 'string' || value === '' || value.length > maxChars) {
    throw bridgeError_('VALIDATION', `Field ${key} tidak valid`);
  }
  return value;
}

export function optText_(
  payload: BridgePayload,
  key: string,
  maxChars: number,
): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxChars) {
    throw bridgeError_('VALIDATION', `Field ${key} tidak valid`);
  }
  return value;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function reqBase64_(payload: BridgePayload, key: string, maxChars: number): string {
  const value = payload[key];
  if (
    typeof value !== 'string' ||
    value.length > maxChars ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw bridgeError_('VALIDATION', `Field ${key} bukan base64 yang valid`);
  }
  return value;
}
