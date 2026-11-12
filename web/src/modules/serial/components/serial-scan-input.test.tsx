import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';

function setup(result: ScanFeedback = 'added', props: { disabled?: boolean } = {}) {
  const onSubmit = vi.fn((_text: string): ScanFeedback => result);
  render(
    <>
      <SerialScanInput id="scan" label="Pindai serial" onSubmit={onSubmit} {...props} />
      <button type="button">Berikutnya</button>
    </>,
  );
  return { onSubmit, input: screen.getByLabelText('Pindai serial') as HTMLTextAreaElement };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('Enter mengirim isi, mengosongkan kolom, dan fokus tetap di kolom', async () => {
  const { onSubmit, input } = setup();
  await userEvent.type(input, 'ABC{Enter}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('ABC');
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
});

test('Enter pada kolom kosong tidak mengirim apa pun', async () => {
  const { onSubmit, input } = setup();
  await userEvent.type(input, '{Enter}');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('Tab saat ada isi menjadi terminator: mengirim dan fokus tidak berpindah', async () => {
  const { onSubmit, input } = setup();
  await userEvent.type(input, 'ABC{Tab}');
  expect(onSubmit).toHaveBeenCalledWith('ABC');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('');
});

test('Tab pada kolom kosong memindahkan fokus seperti biasa dan tidak mengirim', async () => {
  const { onSubmit, input } = setup();
  input.focus();
  await userEvent.tab();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Berikutnya' })).toHaveFocus();
});

test('tempel teks dengan baris baru langsung dikirim apa adanya', async () => {
  const { onSubmit, input } = setup();
  await userEvent.click(input);
  await userEvent.paste('A\nB');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('A\nB');
  expect(input).toHaveValue('');
});

test('tempel satu baris tanpa baris baru hanya mengisi kolom', async () => {
  const { onSubmit, input } = setup();
  await userEvent.click(input);
  await userEvent.paste('ABC');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(input).toHaveValue('ABC');
});

test('Shift+Enter menyisipkan baris baru tanpa mengirim', async () => {
  const { onSubmit, input } = setup();
  await userEvent.type(input, 'A{Shift>}{Enter}{/Shift}B');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(input).toHaveValue('A\nB');
});

test('umpan balik "duplicate" menampilkan teks "Sudah ada" di wilayah aria-live', async () => {
  const { input } = setup('duplicate');
  await userEvent.type(input, 'ABC{Enter}');
  const live = screen.getByText('Sudah ada');
  expect(live).toHaveAttribute('aria-live', 'polite');
});

test('umpan balik "added" dan "rejected" punya teks masing-masing', async () => {
  const added = setup('added');
  await userEvent.type(added.input, 'A{Enter}');
  expect(screen.getByText('Ditambahkan')).toBeInTheDocument();
});

test('tanpa AudioContext dan tanpa vibrate tidak melempar; dengan keduanya dipakai', async () => {
  const { input } = setup();
  await expect(userEvent.type(input, 'ABC{Enter}')).resolves.not.toThrow();

  const start = vi.fn();
  const stop = vi.fn();
  class FakeAudio {
    currentTime = 0;
    destination = {};
    createOscillator = () => ({ frequency: { value: 0 }, connect: vi.fn(), start, stop });
    createGain = () => ({ gain: { value: 0 }, connect: vi.fn() });
    close = vi.fn(() => Promise.resolve());
  }
  vi.stubGlobal('AudioContext', FakeAudio);
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  await userEvent.type(input, 'DEF{Enter}');
  expect(start).toHaveBeenCalled();
  expect(vibrate).toHaveBeenCalled();
  Reflect.deleteProperty(navigator, 'vibrate');
});

test('disabled tidak menerima masukan', async () => {
  const { onSubmit, input } = setup('added', { disabled: true });
  expect(input).toBeDisabled();
  await userEvent.type(input, 'ABC{Enter}');
  expect(input).toHaveValue('');
  expect(onSubmit).not.toHaveBeenCalled();
});
