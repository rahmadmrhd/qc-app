import { describe, expect, test } from 'bun:test';
import { parsePublishArgs } from './publish-desktop-release';

const ID = 'folder-rilis-1234';

describe('parsePublishArgs', () => {
  test('publish: semua argumen wajib', () => {
    expect(
      parsePublishArgs([
        '--version',
        '1.2.3',
        '--folder-id',
        ID,
        '--dir',
        'out',
        '--changelog-file',
        'c.md',
      ]),
    ).toEqual({
      mode: 'publish',
      version: '1.2.3',
      folderId: ID,
      dir: 'out',
      changelogFile: 'c.md',
    });
    expect(parsePublishArgs(['--version', '1.2.3', '--folder-id', ID, '--dir', 'out'])).toBeNull();
  });

  test('withdraw: hanya versi dan folder; argumen publish ikut = salah pakai', () => {
    expect(parsePublishArgs(['--version', '1.2.3', '--folder-id', ID, '--withdraw'])).toEqual({
      mode: 'withdraw',
      version: '1.2.3',
      folderId: ID,
    });
    expect(
      parsePublishArgs(['--version', '1.2.3', '--folder-id', ID, '--withdraw', '--dir', 'out']),
    ).toBeNull();
  });

  test('versi tak sah, id folder tak sah, argumen asing, nilai hilang, atau argumen ganda ditolak', () => {
    expect(parsePublishArgs(['--version', '01.2.3', '--folder-id', ID, '--withdraw'])).toBeNull();
    expect(
      parsePublishArgs(['--version', '1.2.3-rc1', '--folder-id', ID, '--withdraw']),
    ).toBeNull();
    expect(
      parsePublishArgs(['--version', '1.2.3', '--folder-id', '../x', '--withdraw']),
    ).toBeNull();
    expect(parsePublishArgs(['--version', '1.2.3', '--folder-id', ID, '--aneh'])).toBeNull();
    expect(parsePublishArgs(['--version', '--folder-id', ID, '--withdraw'])).toBeNull();
    expect(
      parsePublishArgs([
        '--version',
        '1.2.3',
        '--version',
        '1.2.4',
        '--folder-id',
        ID,
        '--withdraw',
      ]),
    ).toBeNull();
    expect(parsePublishArgs([])).toBeNull();
  });
});
