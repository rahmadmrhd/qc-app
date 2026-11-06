import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { createSmtpMailer, type MailTransport, type SmtpSettings } from './mail';

const SENTINEL = 'SANDI-SMTP-SENTINEL-77a';
const SETTINGS: SmtpSettings = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  user: 'pengirim@example.test',
  pass: SENTINEL,
  from: 'QC App <pengirim@example.test>',
};

describe('createSmtpMailer (transport disuntik)', () => {
  test('meneruskan from/to/subject/text dan membangun transport dari pengaturan SMTP', async () => {
    const created: unknown[] = [];
    const sent: unknown[] = [];
    const mailer = createSmtpMailer(SETTINGS, {
      createTransport: (options) => {
        created.push(options);
        return { sendMail: async (message) => void sent.push(message) } satisfies MailTransport;
      },
    });
    await mailer.send({ to: ['a@x.test', 'b@x.test'], subject: 'Halo', text: 'Isi pesan' });
    expect(created[0]).toMatchObject({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'pengirim@example.test', pass: SENTINEL },
    });
    expect(sent).toEqual([
      {
        from: 'QC App <pengirim@example.test>',
        to: 'a@x.test, b@x.test',
        subject: 'Halo',
        text: 'Isi pesan',
      },
    ]);
  });

  test('tanpa SMTP_USER: tanpa autentikasi', async () => {
    const created: Array<{ auth?: unknown }> = [];
    const mailer = createSmtpMailer(
      { ...SETTINGS, user: '', pass: '' },
      {
        createTransport: (options) => {
          created.push(options);
          return { sendMail: async () => {} };
        },
      },
    );
    await mailer.send({ to: ['a@x.test'], subject: 's', text: 't' });
    expect(created[0]?.auth).toBeUndefined();
  });

  test('galat transport dibungkus tanpa SMTP_PASS (galat asli tidak diteruskan)', async () => {
    const mailer = createSmtpMailer(SETTINGS, {
      createTransport: () => ({
        sendMail: async () => {
          throw new Error(`535 Authentication failed for pengirim:${SENTINEL}`);
        },
      }),
    });
    const error = await mailer.send({ to: ['a@x.test'], subject: 's', text: 't' }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error?.message)).toContain('535');
    expect(String(error?.message)).not.toContain(SENTINEL);
    expect(String(error?.stack)).not.toContain(SENTINEL);
    expect(error?.cause).toBeUndefined();
  });
});

describe('nodemailer di Bun terhadap server SMTP palsu (bukti kompatibilitas)', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  test('EHLO/MAIL/RCPT/DATA berjalan dan pesan sampai utuh', async () => {
    const commands: string[] = [];
    let data = '';
    server = createServer((socket) => {
      let buffer = '';
      let inData = false;
      socket.write('220 fake ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          if (inData) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end < 0) return;
            data = buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            inData = false;
            socket.write('250 OK queued\r\n');
            continue;
          }
          const lineEnd = buffer.indexOf('\r\n');
          if (lineEnd < 0) return;
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          commands.push(line.split(' ')[0] as string);
          if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250 8BITMIME\r\n');
          else if (/^DATA/i.test(line)) {
            inData = true;
            socket.write('354 go ahead\r\n');
          } else if (/^QUIT/i.test(line)) {
            socket.write('221 bye\r\n');
            socket.end();
          } else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const mailer = createSmtpMailer({
      host: '127.0.0.1',
      port,
      secure: false,
      user: '',
      pass: '',
      from: 'QC App <qc@example.test>',
    });
    await mailer.send({
      to: ['pemilik@example.test'],
      subject: 'Peringatan cadangan',
      text: 'Cadangan terakhir 40 jam lalu.',
    });
    expect(commands.slice(0, 4)).toEqual(['EHLO', 'MAIL', 'RCPT', 'DATA']); // QUIT menyusul tanpa ditunggu
    expect(data).toContain('Subject: Peringatan cadangan');
    expect(data).toContain('pemilik@example.test');
    expect(data).toContain('Cadangan terakhir 40 jam lalu.');
  });
});
