import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';

type Listener = (event: { matches: boolean }) => void;
let prefersDark = false;
let listeners: Listener[] = [];

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${theme}/${resolvedTheme}`}</p>
      <button type="button" onClick={() => setTheme('dark')}>
        gelap
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        terang
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        sistem
      </button>
    </div>
  );
}

beforeEach(() => {
  prefersDark = false;
  listeners = [];
  document.documentElement.classList.remove('dark');
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('dark') ? prefersDark : false;
    },
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_type: string, listener: Listener) => {
      listeners = listeners.filter((item) => item !== listener);
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('memakai system sebagai awal dan mengikuti preferensi OS', () => {
  prefersDark = true;
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('state')).toHaveTextContent('system/dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('memilih gelap lalu terang mengubah class dan menyimpan pilihan', async () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'gelap' }));
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('qc.theme')).toBe('dark');
  await userEvent.click(screen.getByRole('button', { name: 'terang' }));
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(localStorage.getItem('qc.theme')).toBe('light');
});

test('pilihan tersimpan dipulihkan saat dimuat ulang', () => {
  localStorage.setItem('qc.theme', 'dark');
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('state')).toHaveTextContent('dark/dark');
});

test('saat system, perubahan preferensi OS langsung diterapkan', () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('state')).toHaveTextContent('system/light');
  prefersDark = true;
  act(() => {
    for (const listener of listeners) listener({ matches: true });
  });
  expect(screen.getByTestId('state')).toHaveTextContent('system/dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('tanpa matchMedia (lingkungan lama) tetap berjalan sebagai terang', () => {
  vi.stubGlobal('matchMedia', undefined);
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('state')).toHaveTextContent('system/light');
});
