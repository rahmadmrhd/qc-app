import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Radix (Checkbox, dsb.) membutuhkan ResizeObserver yang tidak ada di jsdom.
class ResizeObserverStub {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// ProseMirror (editor Tiptap) membutuhkan geometri layout yang tidak dimiliki jsdom.
if (typeof Element !== 'undefined') {
  const emptyRects = () => [] as unknown as DOMRectList;
  Element.prototype.getClientRects ??= emptyRects;
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  document.elementFromPoint ??= () => null;
}
