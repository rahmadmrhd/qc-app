import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { useTrackNearViewport } from './near-viewport';

let fake: ReturnType<typeof installIntersectionObserver>;
beforeEach(() => {
  fake = installIntersectionObserver();
});
afterEach(() => fake.restore());

function Probe() {
  const [ref, near] = useTrackNearViewport();
  return (
    <div ref={ref} data-testid="probe">
      {near ? 'dekat' : 'jauh'}
    </div>
  );
}

test('useTrackNearViewport mengikuti keadaan dua arah (tidak lengket)', () => {
  render(<Probe />);
  const probe = screen.getByTestId('probe');
  expect(probe.textContent).toBe('jauh');
  fake.setIntersecting(probe, true);
  expect(probe.textContent).toBe('dekat');
  fake.setIntersecting(probe, false);
  expect(probe.textContent).toBe('jauh');
  fake.setIntersecting(probe, true);
  expect(probe.textContent).toBe('dekat');
});

test('tanpa IntersectionObserver langsung dekat', () => {
  fake.restore();
  const original = globalThis.IntersectionObserver;
  // @ts-expect-error simulasi lingkungan tanpa pengamat persimpangan
  globalThis.IntersectionObserver = undefined;
  try {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('dekat');
  } finally {
    globalThis.IntersectionObserver = original;
  }
});
