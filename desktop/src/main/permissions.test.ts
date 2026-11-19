import { describe, expect, test } from 'vitest';
import { allowPermissionCheck, allowPermissionRequest } from './permissions';

const OK = { requestingUrl: 'app://qc/country-lock', isMainFrame: true, mediaTypes: ['video'] };

describe('allowPermissionRequest', () => {
  test('kamera (video) dari halaman utama app://qc diizinkan', () => {
    expect(allowPermissionRequest('media', OK)).toBe(true);
  });

  test('mikrofon, video+audio, dan tanpa jenis media ditolak', () => {
    expect(allowPermissionRequest('media', { ...OK, mediaTypes: ['audio'] })).toBe(false);
    expect(allowPermissionRequest('media', { ...OK, mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(allowPermissionRequest('media', { ...OK, mediaTypes: [] })).toBe(false);
    expect(
      allowPermissionRequest('media', { requestingUrl: OK.requestingUrl, isMainFrame: true }),
    ).toBe(false);
  });

  test('izin selain media ditolak', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'clipboard-read',
      'display-capture',
      'midi',
    ]) {
      expect(allowPermissionRequest(permission, OK)).toBe(false);
    }
  });

  test('asal lain, subframe, atau URL tak sah ditolak', () => {
    expect(allowPermissionRequest('media', { ...OK, requestingUrl: 'https://qc.rhd.my.id/' })).toBe(
      false,
    );
    expect(allowPermissionRequest('media', { ...OK, requestingUrl: 'app://qc.evil/x' })).toBe(
      false,
    );
    expect(allowPermissionRequest('media', { ...OK, requestingUrl: 'app://qc:8080/x' })).toBe(
      false,
    );
    expect(allowPermissionRequest('media', { ...OK, requestingUrl: 'bukan url' })).toBe(false);
    expect(allowPermissionRequest('media', { ...OK, requestingUrl: undefined })).toBe(false);
    expect(allowPermissionRequest('media', { ...OK, isMainFrame: false })).toBe(false);
  });
});

describe('allowPermissionCheck', () => {
  test('video dan unknown (enumerateDevices) dari app://qc diizinkan', () => {
    expect(allowPermissionCheck('media', 'app://qc', { mediaType: 'video' })).toBe(true);
    expect(allowPermissionCheck('media', 'app://qc/', { mediaType: 'unknown' })).toBe(true);
  });

  test('audio, izin lain, dan asal lain ditolak', () => {
    expect(allowPermissionCheck('media', 'app://qc', { mediaType: 'audio' })).toBe(false);
    expect(allowPermissionCheck('media', 'app://qc', {})).toBe(false);
    expect(allowPermissionCheck('notifications', 'app://qc', { mediaType: 'video' })).toBe(false);
    expect(allowPermissionCheck('media', 'https://qc.rhd.my.id', { mediaType: 'video' })).toBe(
      false,
    );
  });
});
