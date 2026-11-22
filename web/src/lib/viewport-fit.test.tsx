import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { useViewportFit } from './viewport-fit';

function Probe({ enabled, reserved }: { enabled: boolean; reserved?: number }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const height = useViewportFit(node, enabled, reserved);
  return (
    <div>
      <div ref={setNode} data-testid="target" />
      <output data-testid="fit">{height ?? 'none'}</output>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('tak aktif: tak ada ekspresi tinggi', () => {
  render(<Probe enabled={false} />);
  expect(screen.getByTestId('fit')).toHaveTextContent('none');
});

test('aktif: sisa viewport dikurangi bar, padding main, dan celah', () => {
  render(<Probe enabled />);
  const text = screen.getByTestId('fit').textContent ?? '';
  expect(text).toContain('100dvh');
  expect(text).toContain('var(--headroom-offset');
  expect(text).toContain('2 * var(--main-pad');
  expect(text).toContain('12px');
  expect(text).toContain('- 0px -');
});

test('konten pengikut (reservedPx) ikut dikurangi', () => {
  render(<Probe enabled reserved={48} />);
  expect(screen.getByTestId('fit').textContent).toContain('- 48px -');
});

test('spanduk aplikasi yang tampil ikut dihitung dan hilang saat dibuang', async () => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function mocked(this: Element) {
    const height = this.hasAttribute('data-app-banner') ? 30 : 0;
    return { ...original.call(this), height } as DOMRect;
  };
  try {
    render(<Probe enabled reserved={10} />);
    expect(screen.getByTestId('fit').textContent).toContain('- 10px -');
    const banner = document.createElement('div');
    banner.setAttribute('data-app-banner', '');
    document.body.appendChild(banner);
    await vi.waitFor(() => expect(screen.getByTestId('fit').textContent).toContain('- 40px -'));
    await act(async () => {
      banner.remove();
    });
    await vi.waitFor(() => expect(screen.getByTestId('fit').textContent).toContain('- 10px -'));
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
});
