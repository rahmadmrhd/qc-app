import type {
  PushSender,
  PushSendResult,
  PushSubscriptionInfo,
} from '@server/modules/notification/push';

export interface FakePushSend {
  sub: PushSubscriptionInfo;
  payload: string;
}

export interface FakePush extends PushSender {
  /** Semua pengiriman yang diminta, berurutan. */
  sent: FakePushSend[];
  /** Hasil bawaan untuk endpoint yang tak diatur khusus (bawaan sukses). */
  fallback: PushSendResult;
  /** Mengatur hasil untuk satu endpoint. */
  setResult(endpoint: string, result: PushSendResult): void;
}

/** Pengirim push palsu: merekam pengiriman; hasil dapat diatur per endpoint (sukses, gagal, atau `gone`). */
export function createFakePush(): FakePush {
  const results = new Map<string, PushSendResult>();
  const fake: FakePush = {
    sent: [],
    fallback: { ok: true },
    setResult(endpoint, result) {
      results.set(endpoint, result);
    },
    async send(sub, payload) {
      fake.sent.push({ sub, payload });
      return results.get(sub.endpoint) ?? fake.fallback;
    },
  };
  return fake;
}
