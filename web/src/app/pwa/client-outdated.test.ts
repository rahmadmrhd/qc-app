import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getOutdatedLevel,
  raiseOutdatedLevel,
  resetOutdatedForTests,
  subscribeOutdated,
} from './client-outdated';

afterEach(() => resetOutdatedForTests());

describe('penyimpan tingkat "perlu perbarui"', () => {
  test('awalnya none', () => {
    expect(getOutdatedLevel()).toBe('none');
  });

  test('hanya naik: none < deprecated < outdated', () => {
    raiseOutdatedLevel('deprecated');
    expect(getOutdatedLevel()).toBe('deprecated');
    raiseOutdatedLevel('none');
    expect(getOutdatedLevel()).toBe('deprecated');
    raiseOutdatedLevel('outdated');
    expect(getOutdatedLevel()).toBe('outdated');
    raiseOutdatedLevel('deprecated');
    expect(getOutdatedLevel()).toBe('outdated');
  });

  test('pendengar dipanggil sekali per perubahan nyata, bukan pada panggilan yang tak mengubah', () => {
    const listener = vi.fn();
    const off = subscribeOutdated(listener);
    raiseOutdatedLevel('deprecated');
    raiseOutdatedLevel('deprecated');
    raiseOutdatedLevel('none');
    expect(listener).toHaveBeenCalledTimes(1);
    raiseOutdatedLevel('outdated');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    resetOutdatedForTests();
    raiseOutdatedLevel('outdated');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
