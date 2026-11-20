import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { headroomOffset, useHeadroom } from './use-headroom';

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

function setDocumentHeight(px: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: px,
    configurable: true,
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  setDocumentHeight(3000);
});
afterEach(() => {
  Reflect.deleteProperty(window, 'scrollY');
});

test('gulir turun melewati ambang menyembunyikan, gulir naik memunculkan lagi', () => {
  const { result } = renderHook(() => useHeadroom());
  expect(result.current.hidden).toBe(false);
  scrollTo(300);
  expect(result.current.hidden).toBe(true);
  expect(result.current.floating).toBe(true);
  scrollTo(296);
  expect(result.current.hidden).toBe(false);
});

test('di bawah revealAfter tak menyembunyikan dan gerak kecil diabaikan', () => {
  const { result } = renderHook(() => useHeadroom());
  scrollTo(150);
  expect(result.current.hidden).toBe(false);
  scrollTo(300);
  scrollTo(302);
  expect(result.current.hidden).toBe(true);
});

test('halaman pendek tak pernah menyembunyikan bar', () => {
  setDocumentHeight(800);
  const { result } = renderHook(() => useHeadroom());
  scrollTo(300);
  expect(result.current.hidden).toBe(false);
});

test('disabled (pinned) tak pernah menyembunyikan', () => {
  const { result } = renderHook(() => useHeadroom({ disabled: true }));
  scrollTo(300);
  expect(result.current.hidden).toBe(false);
});

test('headroomOffset menambah tinggi bar hanya saat terlihat', () => {
  expect(headroomOffset(false, 96)).toBe('calc(3.5rem + 96px)');
  expect(headroomOffset(true, 96)).toBe('calc(3.5rem + 0px)');
});
