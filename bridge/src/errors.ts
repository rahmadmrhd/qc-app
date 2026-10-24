export type BridgeErrorCode = 'UNAUTHENTICATED' | 'VALIDATION' | 'NOT_FOUND' | 'INTERNAL';

export interface BridgeError extends Error {
  bridgeCode: BridgeErrorCode;
}

export function bridgeError_(code: BridgeErrorCode, message: string): BridgeError {
  const error = new Error(message) as BridgeError;
  error.name = 'BridgeError';
  error.bridgeCode = code;
  return error;
}

/**
 * Penolakan keamanan (tanda tangan, aksi, folder, induk berkas): SELALU berbalasan sama
 * (`UNAUTHENTICATED`) agar penyerang tidak mendapat sinyal tentang penyebab.
 */
export function bridgeDenied_(): BridgeError {
  return bridgeError_('UNAUTHENTICATED', 'Ditolak');
}

export function isBridgeError_(value: unknown): value is BridgeError {
  return (
    value instanceof Error &&
    value.name === 'BridgeError' &&
    typeof (value as Partial<BridgeError>).bridgeCode === 'string'
  );
}
