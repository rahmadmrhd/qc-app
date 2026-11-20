export type DetectedPlatform = { os: 'windows'; arch: 'x64' | 'arm64' } | { os: 'other' };

/** Bagian `navigator` yang dipakai; objek biasa agar tes tak menyentuh global. */
export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ architecture?: string; bitness?: string; platform?: string }>;
  };
}

const IS_WINDOWS = /win/i;
const ARM_UA = /arm64|aarch64/i;

/**
 * Deteksi OS dan arsitektur untuk memilih installer. Hanya Windows yang punya installer; selain itu `other`. Arsitektur
 * dari `userAgentData` (bila ada), cadangan UA, dan bawaan x64. Tidak pernah melempar.
 */
export async function detectPlatform(nav: NavigatorLike): Promise<DetectedPlatform> {
  const ua = nav.userAgent ?? '';
  const platformHint = nav.userAgentData?.platform ?? nav.platform ?? '';
  // "darwin" memuat "win": MacOS dikeluarkan lebih dulu.
  const isWindows =
    /windows/i.test(ua) || (IS_WINDOWS.test(platformHint) && !/darwin/i.test(platformHint));
  if (!isWindows) return { os: 'other' };
  const fromUa: 'x64' | 'arm64' = ARM_UA.test(ua) ? 'arm64' : 'x64';
  const getValues = nav.userAgentData?.getHighEntropyValues;
  if (typeof getValues !== 'function') return { os: 'windows', arch: fromUa };
  try {
    const values = await getValues.call(nav.userAgentData, ['architecture', 'bitness']);
    if (typeof values.architecture === 'string' && values.architecture !== '') {
      return { os: 'windows', arch: /arm/i.test(values.architecture) ? 'arm64' : 'x64' };
    }
  } catch {
    // Peramban menolak petunjuk: pakai tebakan dari UA.
  }
  return { os: 'windows', arch: fromUa };
}
