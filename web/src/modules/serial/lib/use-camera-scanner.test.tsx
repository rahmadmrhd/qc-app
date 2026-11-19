import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BarcodeEngine } from './barcode-engine';
import { useCameraScanner } from './use-camera-scanner';

function Harness({ engine, onPayload }: { engine: BarcodeEngine; onPayload: () => void }) {
  const camera = useCameraScanner({
    open: true,
    deviceId: '',
    createEngine: async () => engine,
    onPayload,
  });
  return (
    <div>
      {/* biome-ignore lint/a11y/useMediaCaption: video palsu untuk tes */}
      <video ref={camera.videoRef} />
      <p data-testid="status">{camera.state.status}</p>
    </div>
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
  Reflect.deleteProperty(document, 'hidden');
});

test('tab tersembunyi menghentikan loop baca (tidak ada bacaan baru) dan tab terlihat melanjutkannya', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({ deviceId: 'cam-1' }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  const engine: BarcodeEngine = {
    kind: 'native',
    detect: vi.fn(async () => []),
    detectCodes: vi.fn(async () => []),
  };
  const view = render(<Harness engine={engine} onPayload={() => undefined} />);
  await waitFor(() => expect(view.getByTestId('status')).toHaveTextContent('scanning'));
  await waitFor(() => expect(engine.detectCodes).toHaveBeenCalled());

  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Satu putaran yang sudah terjadwal boleh selesai; sesudahnya tidak ada bacaan lagi.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const calls = vi.mocked(engine.detectCodes).mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(vi.mocked(engine.detectCodes).mock.calls.length).toBe(calls);
  expect(track.stop).toHaveBeenCalled();

  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() =>
    expect(vi.mocked(engine.detectCodes).mock.calls.length).toBeGreaterThan(calls),
  );
});
