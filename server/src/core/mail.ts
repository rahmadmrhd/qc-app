import { createTransport } from 'nodemailer';
import { redactSecrets } from './redact';

/** Pengaturan SMTP generik (tanpa kode khusus penyedia): berpindah penyedia = mengganti `.env`. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** true = TLS langsung (biasanya port 465); false = polos atau STARTTLS bila server menawarkannya (587). */
  secure: boolean;
  /** Kosong = tanpa autentikasi. */
  user: string;
  pass: string;
  from: string;
}

export interface MailMessage {
  to: string[];
  /** Tembusan (terlihat penerima lain). Bila `to` kosong, `to` diisi alamat pengirim. */
  cc?: string[];
  /** Penerima tersembunyi (tidak saling terlihat). Bila `to` kosong, `to` diisi alamat pengirim. */
  bcc?: string[];
  subject: string;
  text: string;
  /** Bagian HTML (alternatif dari `text`, yang tetap selalu ikut). */
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Bagian transport nodemailer yang dipakai (disuntik tes). */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

/**
 * Alamat polos dari pengaturan `from`: bentuk `Nama <alamat>` menjadi `alamat`, tanpa tanda kurung dipakai apa adanya.
 * Dipakai mengisi `to` bila pesan hanya punya penerima `cc` atau `bcc`.
 */
export function senderAddress(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return (match?.[1] ?? from).trim();
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  /** Wajib STARTTLS: tanpa ini penyerang di jalur dapat membuang penawaran STARTTLS dan AUTH terkirim polos. */
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

export interface MailDeps {
  createTransport?: (options: SmtpTransportOptions) => MailTransport;
}

const TIMEOUT_MS = 20_000;

/**
 * Pengirim email lewat SMTP (`nodemailer`). Galat dibungkus dengan pesan yang dibersihkan dari `SMTP_PASS` dan
 * TANPA `cause` (galat asli nodemailer dapat memuat perintah/respons protokol); kata sandi tidak pernah ke log.
 */
export function createSmtpMailer(settings: SmtpSettings, deps: MailDeps = {}): Mailer {
  const options: SmtpTransportOptions = {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // Autentikasi tidak pernah polos; relay tanpa autentikasi (user kosong) boleh polos.
    requireTLS: !settings.secure && settings.user !== '',
    ...(settings.user === '' ? {} : { auth: { user: settings.user, pass: settings.pass } }),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  };
  let transport: MailTransport | undefined;
  return {
    async send(message) {
      try {
        transport ??= (deps.createTransport ?? createTransport)(options) as MailTransport;
        const cc = message.cc ?? [];
        const bcc = message.bcc ?? [];
        await transport.sendMail({
          from: settings.from,
          to:
            message.to.length === 0 && cc.length + bcc.length > 0
              ? senderAddress(settings.from)
              : message.to.join(', '),
          ...(cc.length > 0 ? { cc: cc.join(', ') } : {}),
          ...(bcc.length > 0 ? { bcc: bcc.join(', ') } : {}),
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Pengiriman email gagal: ${redactSecrets(text, settings.pass, settings.user)}`,
        );
      }
    },
  };
}
