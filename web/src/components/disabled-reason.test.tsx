import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { DisabledReason } from './disabled-reason';

let media: ReturnType<typeof mockMatchMedia> | undefined;

afterEach(() => {
  media?.restore();
  media = undefined;
  cleanup();
});

function renderReason(reason: string | undefined) {
  render(
    <TooltipProvider>
      <DisabledReason reason={reason} className="flex-1">
        <button type="button" disabled>
          Hapus
        </button>
      </DisabledReason>
    </TooltipProvider>,
  );
}

test('tanpa alasan: anak dirender apa adanya', () => {
  renderReason(undefined);
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  expect(screen.queryByText('alasan')).toBeNull();
});

test('lebar: alasan lewat tooltip (teks sr-only untuk pembaca layar), className diteruskan ke pembungkus', async () => {
  renderReason('Nonaktifkan dulu');
  const wrapper = screen.getByRole('button', { name: 'Hapus' }).parentElement as HTMLElement;
  expect(wrapper).toHaveClass('flex-1');
  expect(wrapper).toHaveAttribute('tabindex', '0');
  expect(screen.getByText('Nonaktifkan dulu')).toHaveClass('sr-only');
  await userEvent.hover(wrapper);
  expect(await screen.findAllByText('Nonaktifkan dulu')).not.toHaveLength(0);
});

test('ponsel: alasan tampil sebagai teks terlihat di bawah tombol tanpa perlu hover', () => {
  media = mockMatchMedia(false);
  renderReason('Nonaktifkan dulu');
  const text = screen.getByText('Nonaktifkan dulu');
  expect(text).not.toHaveClass('sr-only');
  const wrapper = screen.getByRole('button', { name: 'Hapus' }).parentElement as HTMLElement;
  expect(wrapper).toContainElement(text);
  expect(wrapper).toHaveClass('flex-1');
  expect(wrapper).not.toHaveAttribute('tabindex');
});
