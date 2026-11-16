import { NOTIFICATIONS_CHANGE_EVENT } from '@countrylock/bridge-channels';
import { describe, expect, test } from 'vitest';
import { forwardNotificationsChanged } from './forward';

function fakeWindow(options: { destroyed?: boolean; throws?: boolean } = {}) {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  return {
    sent,
    window: {
      isDestroyed: () => options.destroyed === true,
      webContents: {
        send: (channel: string, ...args: unknown[]) => {
          if (options.throws) throw new Error('Object has been destroyed');
          sent.push({ channel, args });
        },
      },
    },
  };
}

describe('forwardNotificationsChanged', () => {
  test('mengirim satu peristiwa di kanal yang benar, TANPA muatan', () => {
    const { window, sent } = fakeWindow();
    forwardNotificationsChanged(window);
    expect(sent).toEqual([{ channel: NOTIFICATIONS_CHANGE_EVENT, args: [] }]);
  });

  test('tanpa jendela atau jendela sudah dibongkar: diam', () => {
    expect(() => forwardNotificationsChanged(null)).not.toThrow();
    const gone = fakeWindow({ destroyed: true });
    forwardNotificationsChanged(gone.window);
    expect(gone.sent).toEqual([]);
  });

  test('pengiriman gagal (renderer dibongkar) tidak melempar sehingga aliran tak terputus', () => {
    const { window } = fakeWindow({ throws: true });
    expect(() => forwardNotificationsChanged(window)).not.toThrow();
  });
});
