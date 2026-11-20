import { describe, expect, test } from 'vitest';
import { detectPlatform } from './detect-platform';

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('detectPlatform', () => {
  test('Windows tanpa userAgentData memakai UA: x64 bawaan', async () => {
    expect(await detectPlatform({ userAgent: WIN_UA, platform: 'Win32' })).toEqual({
      os: 'windows',
      arch: 'x64',
    });
  });

  test('UA yang menyebut ARM64 = arm64', async () => {
    expect(
      await detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; ARM64) Chrome/130.0' }),
    ).toEqual({ os: 'windows', arch: 'arm64' });
  });

  test('userAgentData: arsitektur arm = arm64, x86 = x64', async () => {
    const withArch = (architecture: string) => ({
      userAgent: WIN_UA,
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ architecture, bitness: '64' }),
      },
    });
    expect(await detectPlatform(withArch('arm'))).toEqual({ os: 'windows', arch: 'arm64' });
    expect(await detectPlatform(withArch('x86'))).toEqual({ os: 'windows', arch: 'x64' });
  });

  test('getHighEntropyValues menolak: jatuh ke UA tanpa melempar', async () => {
    const result = await detectPlatform({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; ARM64) Chrome/130.0',
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => {
          throw new Error('ditolak');
        },
      },
    });
    expect(result).toEqual({ os: 'windows', arch: 'arm64' });
  });

  test.each([
    ['macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'],
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'],
  ])('%s = os lain', async (_name, userAgent) => {
    expect(await detectPlatform({ userAgent })).toEqual({ os: 'other' });
  });

  test('objek kosong = os lain', async () => {
    expect(await detectPlatform({})).toEqual({ os: 'other' });
  });
});
