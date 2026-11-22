import type { AuditEntryDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { makeMe } from '@/test/make-me';
import { mountRoute } from '@/test/mount-route';
import { Route } from './audit';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));

const entry = (id: string, patch: Partial<AuditEntryDto> = {}): AuditEntryDto => ({
  id,
  ts: '2026-11-20T03:04:05.000Z',
  actor: 'admin@x.com',
  action: 'user.update',
  target: `target-${id}`,
  before: { name: 'Lama' },
  after: { name: 'Baru' },
  targetRef: { kind: 'user', id: `u-${id}` },
  ...patch,
});

let pages: { entries: AuditEntryDto[]; nextCursor: string | null }[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  calls = [];
  pages = [
    { entries: [entry('1'), entry('2')], nextCursor: 'c2' },
    { entries: [entry('3')], nextCursor: null },
  ];
  apiMock.mockImplementation(async (id: string, input: { cursor?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'access.audit.list':
        return input?.cursor ? pages[1] : pages[0];
      case 'access.roles.list':
      case 'access.locations.list':
      case 'access.businessUnits.list':
        return [];
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount(entryPath = '/_app/access/audit') {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/access/audit',
    entry: entryPath,
    me: makeMe({ permissions: { access: 'view' } }),
  });
  await screen.findByRole('table', { name: 'Log audit' });
  return result;
}

test('target menaut ke View entitas; "Muat lebih banyak" memuat halaman berikutnya', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'target-1' })).toHaveAttribute(
    'href',
    '/access/users/u-1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  await screen.findByText('target-3');
  expect(calls.filter((call) => call.id === 'access.audit.list').map((call) => call.input)).toEqual(
    [{}, { cursor: 'c2' }],
  );
});

test('Lihat detail membuka lembar diff; tidak mengganti halaman', async () => {
  await mount();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Lihat detail User diubah target-1' }),
  );
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByText(/User diubah: target-1/)).toBeInTheDocument();
});

test('filter aksi dari URL (param tunggal lama action) dibaca sebagai actions dan dikirim ke server', async () => {
  await mount('/_app/access/audit?action=businessunit.update');
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.id === 'access.audit.list' &&
          (call.input as { actions?: string[] }).actions?.[0] === 'businessunit.update',
      ),
    ).toBe(true),
  );
  expect(screen.getByText('Business Unit diubah')).toBeInTheDocument();
});

test('filter aksi jamak dari URL dikirim sebagai daftar dan chip menampilkan nama digabung', async () => {
  const actions = encodeURIComponent(JSON.stringify(['businessunit.update', 'user.update']));
  await mount(`/_app/access/audit?actions=${actions}`);
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.id === 'access.audit.list' &&
          JSON.stringify((call.input as { actions?: string[] }).actions) ===
            JSON.stringify(['businessunit.update', 'user.update']),
      ),
    ).toBe(true),
  );
  expect(
    screen.getByRole('button', { name: 'Aksi: Business Unit diubah, User diubah' }),
  ).toBeInTheDocument();
});
