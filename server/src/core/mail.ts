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
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Bagian transport nodemailer yang dipakai (disuntik tes). */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
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
        await transport.sendMail({
          from: settings.from,
          to: message.to.join(', '),
          subject: message.subject,
          text: message.text,
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
