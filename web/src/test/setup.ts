import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetUiUpdateStore } from '@/app/ui-update-store';
import { resetCameraBlocked } from '@/modules/serial/lib/camera-session';

afterEach(() => {
  cleanup();
  // Keadaan "UI baru siap" bersifat tingkat modul; jangan bocor antar tes.
  resetUiUpdateStore();
  // Penanda "kamera tak dapat dipakai" bersifat tingkat modul; jangan bocor antar tes.
  resetCameraBlocked();
});

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
  // cmdk (Command) memanggil scrollIntoView pada opsi terpilih; jsdom tidak menyediakannya.
  Element.prototype.scrollIntoView ??= () => undefined;
}
