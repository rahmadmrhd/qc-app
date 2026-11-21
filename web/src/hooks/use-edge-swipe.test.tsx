import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EDGE_SWIPE_MIN_PX, useEdgeSwipe } from './use-edge-swipe';

function Host({ onSwipe, enabled = true }: { onSwipe: () => void; enabled?: boolean }) {
  useEdgeSwipe(onSwipe, enabled);
  return null;
}

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

test('geser mendatar dari tepi kiri membuka sekali', () => {
  const onSwipe = vi.fn();
  render(<Host onSwipe={onSwipe} />);
  fireEvent.touchStart(document, touch(5, 300));
  fireEvent.touchMove(document, touch(5 + EDGE_SWIPE_MIN_PX + 4, 305));
  fireEvent.touchMove(document, touch(200, 305));
  expect(onSwipe).toHaveBeenCalledTimes(1);
});

test('tidak membuka: mulai di luar zona tepi, gulir vertikal, geser ke kiri, atau dinonaktifkan', () => {
  const onSwipe = vi.fn();
  const view = render(<Host onSwipe={onSwipe} />);
  fireEvent.touchStart(document, touch(120, 300));
  fireEvent.touchMove(document, touch(300, 300));
  fireEvent.touchStart(document, touch(5, 300));
  fireEvent.touchMove(document, touch(20, 420));
  fireEvent.touchMove(document, touch(200, 420));
  fireEvent.touchStart(document, touch(15, 300));
  fireEvent.touchMove(document, touch(2, 300));
  fireEvent.touchMove(document, touch(200, 300));
  expect(onSwipe).not.toHaveBeenCalled();
  view.rerender(<Host onSwipe={onSwipe} enabled={false} />);
  fireEvent.touchStart(document, touch(5, 300));
  fireEvent.touchMove(document, touch(200, 300));
  expect(onSwipe).not.toHaveBeenCalled();
});
