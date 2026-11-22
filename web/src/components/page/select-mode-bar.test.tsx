import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SelectModeBar } from './select-mode-bar';

function actions(count: number) {
  return ['Satu', 'Dua', 'Tiga', 'Empat'].slice(0, count).map((label) => (
    <button key={label} type="button">
      {label}
    </button>
  ));
}

function setup(
  props: Partial<{ count: number; allSelected: boolean; busy: boolean; actions: number }> = {},
) {
  const onToggleAll = vi.fn();
  const onExit = vi.fn();
  render(
    <SelectModeBar
      count={props.count ?? 0}
      allSelected={props.allSelected ?? false}
      busy={props.busy}
      onToggleAll={onToggleAll}
      onExit={onExit}
    >
      {actions(props.actions ?? 2)}
    </SelectModeBar>,
  );
  return { onToggleAll, onExit };
}

const bar = () => screen.getByRole('region', { name: 'Aksi massal' });

test('SATU baris: [kotak centang][N dipilih][jarak][aksi], tanpa tombol Batalkan pilihan', () => {
  setup({ count: 2, allSelected: false });
  const element = bar();
  expect(element.className).toContain('fixed');
  expect(screen.queryByRole('button', { name: 'Batalkan pilihan' })).toBeNull();
  // Satu baris: tanpa kolom bertumpuk.
  expect(element.className).not.toContain('flex-col');
  const order = Array.from(element.querySelectorAll('[role=checkbox], [role=status], button')).map(
    (node) => (node.getAttribute('role') === 'checkbox' ? 'checkbox' : node.textContent),
  );
  expect(order).toEqual(['checkbox', '2 dipilih', 'Satu', 'Dua']);
});

test('kotak centang tri-state: semua = centang, sebagian = campuran, kosong = tidak tercentang', () => {
  const aria = (allSelected: boolean, count: number) => {
    const { unmount } = render(
      <SelectModeBar count={count} allSelected={allSelected} onToggleAll={vi.fn()} onExit={vi.fn()}>
        {actions(1)}
      </SelectModeBar>,
    );
    const value = screen
      .getByRole('checkbox', { name: 'Pilih semua' })
      .getAttribute('aria-checked');
    unmount();
    return value;
  };
  expect(aria(true, 3)).toBe('true');
  expect(aria(false, 1)).toBe('mixed');
  expect(aria(false, 0)).toBe('false');
});

test('klik kotak centang memanggil toggleAll (pilih semua, atau kosongkan bila sudah semua)', async () => {
  const { onToggleAll } = setup({ count: 1 });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(onToggleAll).toHaveBeenCalledOnce();
});

test('belum ada butir terpilih: teks "Pilih item" dan aksi belum tampil', () => {
  setup({ count: 0 });
  expect(within(bar()).getByRole('status')).toHaveTextContent('Pilih item');
  expect(screen.queryByRole('button', { name: 'Satu' })).toBeNull();
});

test('fokus awal ke kotak centang (pemicu mode pilih hilang dari layar)', () => {
  setup({ count: 1 });
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toHaveFocus();
});

test('Escape keluar dari mode pilih, tetapi tidak saat dialog/menu sedang terbuka', async () => {
  const { onExit } = setup({ count: 1 });
  await userEvent.keyboard('{Escape}');
  expect(onExit).toHaveBeenCalledOnce();

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  await userEvent.keyboard('{Escape}');
  expect(onExit).toHaveBeenCalledOnce();
  dialog.remove();
});

test('sampai dua aksi tampil langsung (tanpa menu tambahan)', () => {
  setup({ count: 2, actions: 2 });
  expect(screen.getByRole('button', { name: 'Satu' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dua' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aksi lainnya' })).toBeNull();
});

test('lebih dari dua aksi: aksi pertama langsung, sisanya di menu "Aksi lainnya" (min-w-56)', async () => {
  setup({ count: 2, actions: 4 });
  expect(screen.getByRole('button', { name: 'Satu' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dua' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
  expect(await screen.findByRole('button', { name: 'Dua' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tiga' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Empat' })).toBeInTheDocument();
  const content = document.querySelector('[data-slot="popover-content"]') as HTMLElement;
  expect(content.className).toContain('min-w-56');
});

test('busy menonaktifkan kotak centang dan aksi', () => {
  setup({ count: 1, busy: true });
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Satu' })).toBeDisabled();
  expect(bar()).toHaveAttribute('aria-busy', 'true');
});
