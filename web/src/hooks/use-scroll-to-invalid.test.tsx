import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useScrollToInvalidOnSubmit } from './use-scroll-to-invalid';

function Harness({ tabbed }: { tabbed?: boolean }) {
  useScrollToInvalidOnSubmit();
  return (
    <div>
      <form
        id="f"
        onSubmit={(event) => {
          event.preventDefault();
          // Galat muncul setelah submit (seperti validasi TanStack Form).
          setTimeout(() => document.getElementById('bad')?.setAttribute('aria-invalid', 'true'), 10);
        }}
      >
        <input id="ok" aria-label="ok" />
        {tabbed ? (
          <>
            <button type="button" role="tab" id="t2" onClick={() => document.getElementById('p2')?.removeAttribute('hidden')}>
              Tab 2
            </button>
            <div role="tabpanel" id="p2" aria-labelledby="t2" hidden>
              <input id="bad" aria-label="bad" />
            </div>
          </>
        ) : (
          <input id="bad" aria-label="bad" />
        )}
      </form>
      <button type="submit" form="f">
        Simpan
      </button>
    </div>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => vi.unstubAllGlobals());

test('Simpan dengan isian bergalat di luar layar: digulir ke isian itu', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
  expect(
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0],
  ).toBe(document.getElementById('bad'));
});

test('isian bergalat di tab tersembunyi: tabnya dibuka lalu digulir', async () => {
  render(<Harness tabbed />);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  expect(document.getElementById('p2')?.hasAttribute('hidden')).toBe(false);
});
