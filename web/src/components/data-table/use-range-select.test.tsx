import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';
import { useRangeSelect } from './use-range-select';

function Harness({
  ids,
  apply,
}: {
  ids: string[];
  apply: (ids: readonly string[], on: boolean) => string | undefined;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { checkboxProps } = useRangeSelect({
    ids,
    isSelected: (id) => selected.has(id),
    apply: (list, on) => {
      const last = apply(list, on);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of list) on ? next.add(id) : next.delete(id);
        return next;
      });
      return last;
    },
  });
  return (
    <div>
      {ids.map((id) => (
        <Checkbox
          key={id}
          aria-label={id}
          checked={selected.has(id)}
          onCheckedChange={(v) =>
            setSelected((prev) => {
              const next = new Set(prev);
              v ? next.add(id) : next.delete(id);
              return next;
            })
          }
          {...checkboxProps(id)}
        />
      ))}
    </div>
  );
}

const IDS = ['a', 'b', 'c', 'd'];

describe('useRangeSelect', () => {
  it('shift-klik memilih rentang dari jangkar', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('b'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('d'));
    await user.keyboard('{/Shift}');
    expect(apply).toHaveBeenCalledWith(['b', 'c', 'd'], true);
    expect(screen.getByLabelText('c')).toBeChecked();
  });

  it('jangkar yang dilepas membuat rentang melepas', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('b'));
    await user.click(screen.getByLabelText('b'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('d'));
    await user.keyboard('{/Shift}');
    expect(apply).toHaveBeenCalledWith(['b', 'c', 'd'], false);
  });

  it('shift-klik tanpa jangkar = toggle biasa', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('c'));
    await user.keyboard('{/Shift}');
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('c')).toBeChecked();
  });

  it('jangkar yang hilang dari ids dianggap tanpa jangkar', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('a'));
    rerender(<Harness ids={['b', 'c', 'd']} apply={apply} />);
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('c'));
    await user.keyboard('{/Shift}');
    expect(apply).not.toHaveBeenCalled();
  });

  it('jangkar pindah ke baris yang di-shift-klik', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('a'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('b'));
    await user.click(screen.getByLabelText('d'));
    await user.keyboard('{/Shift}');
    expect(apply).toHaveBeenNthCalledWith(1, ['a', 'b'], true);
    expect(apply).toHaveBeenNthCalledWith(2, ['b', 'c', 'd'], true);
  });

  it('rentang mundur diteruskan mulai dari sisi jangkar', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('d'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('b'));
    await user.keyboard('{/Shift}');
    expect(apply).toHaveBeenCalledWith(['d', 'c', 'b'], true);
  });

  it('mousedown dengan Shift dicegah', () => {
    render(<Harness ids={IDS} apply={vi.fn()} />);
    const el = screen.getByLabelText('a');
    const shifted = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    el.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(true);
    const plain = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });

  it('apply boleh mengembalikan id terakhir yang diterapkan sebagai jangkar baru', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const apply = vi.fn((list: readonly string[]) => list[Math.min(2, list.length - 1)]);
    const user = userEvent.setup();
    render(<Harness ids={ids} apply={apply} />);
    await user.click(screen.getByLabelText('a'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByLabelText('f'));
    expect(apply).toHaveBeenNthCalledWith(1, ['a', 'b', 'c', 'd', 'e', 'f'], true);
    await user.click(screen.getByLabelText('e'));
    await user.keyboard('{/Shift}');
    expect(apply).toHaveBeenNthCalledWith(2, ['c', 'd', 'e'], true);
  });

  it('Shift+Spasi tanpa keyup tidak menelan klik berikutnya', async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<Harness ids={IDS} apply={apply} />);
    await user.click(screen.getByLabelText('a'));
    const b = screen.getByLabelText('b');
    fireEvent.keyDown(b, { key: ' ', shiftKey: true });
    expect(apply).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText('d'));
    expect(screen.getByLabelText('d')).toBeChecked();
  });

  it('keydown berulang (Shift+Spasi ditahan > 1 dtk) tetap menelan klik sintetis setelah keyup', async () => {
    vi.useFakeTimers();
    try {
      const apply = vi.fn();
      render(<Harness ids={IDS} apply={apply} />);
      const a = screen.getByLabelText('a');
      fireEvent.click(a);
      const c = screen.getByLabelText('c');
      fireEvent.keyDown(c, { key: ' ', shiftKey: true });
      expect(apply).toHaveBeenCalledTimes(1);
      // Tombol ditahan lebih dari 1 dtk: keydown berulang memulai ulang timer cadangan.
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(600);
        fireEvent.keyDown(c, { key: ' ', shiftKey: true, repeat: true });
      }
      expect(apply).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(c, { key: ' ' });
      fireEvent.click(c);
      expect(apply).toHaveBeenCalledTimes(1);
      // Klik sintetis ditelan: c tetap terpilih oleh rentang (tidak di-toggle lepas).
      expect(c).toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });
});
