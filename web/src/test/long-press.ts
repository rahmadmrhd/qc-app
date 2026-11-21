import { act, fireEvent } from '@testing-library/react';
import { LONG_PRESS_MS } from '@/components/data-table/use-long-press-select';

/** Menekan elemen lama (pointerdown, tunggu ambang tekan lama) seperti jari di ponsel; panggil di tes ber-timer asli. */
export async function longPress(element: HTMLElement) {
  fireEvent.pointerDown(element, { clientX: 5, clientY: 5, button: 0, pointerType: 'touch' });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 40));
  });
  fireEvent.pointerUp(element);
}
