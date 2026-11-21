import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const isDesktopMock = vi.hoisted(() => vi.fn(() => false));
const reloadMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/platform', () => ({ isDesktop: isDesktopMock }));
vi.mock('./update', () => ({ usePwaUpdate: () => ({ reload: reloadMock }) }));

import { ApiDeprecatedBanner } from './api-deprecated-banner';
import { raiseOutdatedLevel, resetOutdatedForTests } from './client-outdated';

beforeEach(() => {
  isDesktopMock.mockReturnValue(false);
  reloadMock.mockReset();
});
afterEach(() => resetOutdatedForTests());

describe('ApiDeprecatedBanner', () => {
  test('tidak tampil pada none dan outdated (outdated ditangani spanduk pembaruan)', () => {
    render(<ApiDeprecatedBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => raiseOutdatedLevel('outdated'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('tampil pada deprecated dengan teks dan tombol Muat ulang', async () => {
    render(<ApiDeprecatedBanner />);
    act(() => raiseOutdatedLevel('deprecated'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Aplikasi ini perlu diperbarui biar tetap bisa dipakai.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test('tidak tampil di aplikasi desktop (pembaruan desktop punya layar sendiri)', () => {
    isDesktopMock.mockReturnValue(true);
    render(<ApiDeprecatedBanner />);
    act(() => raiseOutdatedLevel('deprecated'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
