import { describe, expect, test } from 'bun:test';
import {
  base64ByteLength,
  fileRef,
  IMAGE_TARGET_BYTES,
  isBase64Text,
  isImageMime,
  MAX_IMAGE_BYTES,
  matchesImageSignature,
  parseFileRef,
} from './files';

describe('batas ukuran gambar (T30a, keputusan pemilik 2026-11-06)', () => {
  test('batas terima server (tepi) 10 MB; target pengecilan gambar di klien TIDAK ikut naik (tetap 1 MB)', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(IMAGE_TARGET_BYTES).toBe(1024 * 1024);
    expect(IMAGE_TARGET_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
  });
});

describe('isImageMime', () => {
  test('hanya JPEG, PNG, dan WebP', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    for (const value of ['image/gif', 'image/svg+xml', 'text/html', '', 42, null]) {
      expect(isImageMime(value)).toBe(false);
    }
  });
});

describe('isBase64Text', () => {
  test('menerima base64 baku dan menolak yang rusak', () => {
    expect(isBase64Text('QUJD')).toBe(true);
    expect(isBase64Text('QUI=')).toBe(true);
    expect(isBase64Text('QQ==')).toBe(true);
    for (const value of [
      '',
      'QUJ',
      'QU JD',
      'QUJD\n',
      'QUJD!',
      'Q===',
      'data:image/png;base64,QUJD',
    ]) {
      expect(isBase64Text(value)).toBe(false);
    }
  });
});

describe('base64ByteLength', () => {
  test('menghitung ukuran byte hasil decode', () => {
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(base64ByteLength('QUI=')).toBe(2);
    expect(base64ByteLength('QQ==')).toBe(1);
    expect(base64ByteLength('QUJDREVG')).toBe(6);
  });
});

describe('matchesImageSignature', () => {
  test('awalan base64 harus cocok dengan MIME yang diklaim', () => {
    expect(matchesImageSignature('image/png', 'iVBORw0KGgoAAAANSUhEUg==')).toBe(true);
    expect(matchesImageSignature('image/jpeg', '/9j/4AAQSkZJRg==')).toBe(true);
    expect(matchesImageSignature('image/webp', 'UklGRhwAAABXRUJQ')).toBe(true);
    expect(matchesImageSignature('image/webp', 'UklGRhwAAABXQVZF')).toBe(false); // WAV: RIFF tetapi bukan WEBP
    expect(matchesImageSignature('image/webp', 'UklGR')).toBe(false); // terlalu pendek
    expect(matchesImageSignature('image/png', '/9j/4AAQSkZJRg==')).toBe(false);
    expect(matchesImageSignature('image/jpeg', 'PHNjcmlwdD4=')).toBe(false);
  });
});

describe('referensi berkas', () => {
  test('fileRef dan parseFileRef saling berbalik; yang lain ditolak', () => {
    expect(fileRef('abc-123')).toBe('qcfile:abc-123');
    expect(parseFileRef('qcfile:abc-123')).toBe('abc-123');
    for (const value of [
      'qcfile:',
      'https://x.test/a.png',
      'QCFILE:abc',
      'qcfile:a b',
      'qcfile:a/b',
      '',
    ]) {
      expect(parseFileRef(value)).toBeNull();
    }
  });
});
