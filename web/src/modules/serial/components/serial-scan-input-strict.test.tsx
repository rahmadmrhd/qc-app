import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProofSession } from '../lib/use-proof-uploads';
import type { StrictScan } from './camera-scan-button';
import { SerialScanInput } from './serial-scan-input';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function strictContext(over: Partial<StrictScan> = {}): StrictScan {
  return {
    info: {
      itemLabel: 'Cisco C9200',
      buLabel: 'BU1',
      locationLabel: 'Jakarta',
      testDate: '2026-11-18',
      proofMin: 2,
      stamp: {
        itemLabel: 'Cisco C9200',
        buLabel: 'BU1',
        locationLabel: 'Jakarta',
        actorName: 'Budi',
        actorTeam: 'QC',
      },
    },
    isKnown: () => false,
    onConfirm: vi.fn(),
    newOwnerId: () => 'owner-1',
    proof: {
      uploads: {
        entries: [],
        busy: false,
        hasFailed: false,
        cancelOwner: vi.fn(),
        forOwner: () => ({
          entries: [],
          busy: false,
          hasFailed: false,
          add: vi.fn(),
          retry: vi.fn(),
          remove: vi.fn(),
        }),
      },
      attach: () => () => undefined,
    } satisfies ProofSession,
    ...over,
  };
}

function setup(strict?: StrictScan) {
  const onSubmit = vi.fn(() => 'added' as const);
  render(<SerialScanInput id="scan" label="Scan serial" onSubmit={onSubmit} strict={strict} />);
  return { onSubmit, field: screen.getByLabelText('Scan serial') };
}

test('strict: satu serial sah membuka dialog di langkah 2 dan tidak memanggil onSubmit', async () => {
  const { onSubmit, field } = setup(strictContext());
  await userEvent.click(field);
  await userEvent.type(field, 'abc123{Enter}');
  expect(await screen.findByRole('textbox', { name: 'Serial Number' })).toHaveValue('ABC123');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('strict: Tab sebagai terminator pemindai fisik juga membuka dialog', async () => {
  const { field } = setup(strictContext());
  await userEvent.click(field);
  await userEvent.type(field, 'abc123{Tab}');
  expect(await screen.findByRole('textbox', { name: 'Serial Number' })).toHaveValue('ABC123');
});

test('strict: tempelan banyak serial ditolak dengan catatan, tanpa dialog', async () => {
  const { onSubmit, field } = setup(strictContext());
  await userEvent.click(field);
  await userEvent.paste(`A1${String.fromCharCode(10)}B2`);
  expect(await screen.findByText(/Item ini wajib foto: satu serial per kali/)).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('strict: serial yang sudah ada di draft = Sudah ada tanpa dialog', async () => {
  const { field } = setup(strictContext({ isKnown: (serial) => serial === 'ABC123' }));
  await userEvent.click(field);
  await userEvent.type(field, 'abc123{Enter}');
  expect(await screen.findByText('Sudah ada')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('tanpa strict: perilaku lama (langsung onSubmit)', async () => {
  const { onSubmit, field } = setup();
  await userEvent.click(field);
  await userEvent.type(field, 'abc123{Enter}');
  expect(onSubmit).toHaveBeenCalledWith('abc123');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('strict: tombol kamera membuka dialog dua langkah (langkah 1)', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  setup(strictContext());
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('Scan serial item wajib foto');
  expect(screen.queryByRole('textbox', { name: 'Serial Number' })).not.toBeInTheDocument();
});

test('strict: draft penuh menolak dari awal dengan catatan batas, tanpa dialog', async () => {
  const { onSubmit, field } = setup(strictContext({ capacity: () => 0 }));
  await userEvent.click(field);
  await userEvent.type(field, 'abc123{Enter}');
  expect(await screen.findByText(/Draft sudah penuh \(maks\. 1000 baris\)/)).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('strict: tombol kamera dengan draft penuh membuka dialog yang hanya memberi tahu batas', async () => {
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  setup(strictContext({ capacity: () => 0 }));
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(await screen.findByTestId('strict-full')).toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
});
