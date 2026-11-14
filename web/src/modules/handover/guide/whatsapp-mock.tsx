import { ArrowLeft, Copy, Forward, MoreVertical, Star, Trash2, User } from 'lucide-react';

/**
 * Tiruan tata letak chat WhatsApp untuk demo tooltip (spek 4.6): bilah atas, latar chat, bubble masuk/keluar, dan
 * bilah pilihan. Hanya tiruan tampilan (tanpa logo, gambar, atau aset resmi WhatsApp). Warna memakai skema
 * WhatsApp sendiri dengan varian `dark:` agar terbaca di terang dan gelap; ukuran mengikuti lebar induk (ponsel
 * sempit) tanpa scroll horizontal. Ilustrasi saja: `aria-hidden`, maknanya dibawa keterangan adegan.
 */

export interface WaMessage {
  id: string;
  /** Nama pengirim (bubble masuk); kosong untuk bubble keluar. */
  sender?: string;
  /** Jam tampil di kanan bawah bubble, mis. "09.15". */
  time: string;
  /** Satu entri = satu baris di bubble. */
  lines: readonly string[];
  outgoing?: boolean;
  /** Indeks warna nama pengirim (WhatsApp mewarnai tiap pengirim berbeda). */
  senderTone?: 0 | 1;
}

export interface WhatsappMockProps {
  contactName: string;
  contactSubtitle: string;
  messages: readonly WaMessage[];
  /** Id pesan yang tersorot; tidak kosong = bilah atas berubah menjadi bilah pilihan berisi jumlahnya. */
  selectedIds?: readonly string[];
  /** Ikon salin pada bilah pilihan disorot dan toast "Disalin" tampil. */
  copied?: boolean;
}

const SENDER_TONES = [
  'text-[#b3501f] dark:text-[#f0a35e]',
  'text-[#0b7a75] dark:text-[#53bdeb]',
] as const;

const ICON_BUTTON = 'inline-flex size-6 items-center justify-center rounded-full';

function Bubble({ message, selected }: { message: WaMessage; selected: boolean }) {
  const outgoing = message.outgoing === true;
  return (
    <div className={`relative flex px-2 py-0.5 ${outgoing ? 'justify-end' : 'justify-start'}`}>
      {selected ? (
        <span
          data-slot="wa-selected"
          className="absolute inset-0 animate-in bg-[#34b7f1]/25 duration-300 fade-in"
        />
      ) : null}
      <div
        className={`relative max-w-[85%] min-w-0 rounded-lg px-2 pt-1 pb-0.5 text-[11px] leading-snug shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
          outgoing
            ? 'rounded-tr-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]'
            : 'rounded-tl-none bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0 size-2 bg-inherit ${
            outgoing
              ? '-right-1.5 [clip-path:polygon(0_0,100%_0,0_100%)]'
              : '-left-1.5 [clip-path:polygon(100%_0,0_0,100%_100%)]'
          }`}
        />
        {!outgoing && message.sender ? (
          <p className={`font-medium ${SENDER_TONES[message.senderTone ?? 0]}`}>{message.sender}</p>
        ) : null}
        {message.lines.map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
        <p className="text-right text-[9px] text-[#667781] dark:text-[#8696a0]">{message.time}</p>
      </div>
    </div>
  );
}

function ContactBar({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 bg-[#008069] px-2 py-1.5 text-white dark:bg-[#1f2c34] dark:text-[#e9edef]">
      <ArrowLeft className="size-4 shrink-0" />
      <span
        className={`${ICON_BUTTON} size-7 shrink-0 bg-white/25 dark:bg-[#6a7175]`}
        data-slot="wa-avatar"
      >
        <User className="size-4" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="truncate text-[9px] opacity-80">{subtitle}</p>
      </div>
      <MoreVertical className="size-4 shrink-0" />
    </div>
  );
}

function SelectionBar({ count, copied }: { count: number; copied: boolean }) {
  return (
    <div
      data-slot="wa-selection-bar"
      className="flex animate-in items-center gap-2 bg-white px-2 py-1.5 text-[#54656f] shadow-sm duration-200 fade-in dark:bg-[#1f2c34] dark:text-[#aebac1]"
    >
      <ArrowLeft className="size-4 shrink-0" />
      <span
        data-slot="wa-count"
        className="flex-1 text-sm font-medium text-[#111b21] dark:text-[#e9edef]"
      >
        {count}
      </span>
      <Star className="size-4 shrink-0" />
      <Trash2 className="size-4 shrink-0" />
      <span
        data-slot="wa-copy"
        data-active={copied ? 'true' : undefined}
        className={`${ICON_BUTTON} ${
          copied ? 'bg-[#008069] text-white ring-2 ring-[#008069]/40 dark:bg-[#00a884]' : ''
        }`}
      >
        <Copy className="size-4" />
      </span>
      <Forward className="size-4 shrink-0" />
    </div>
  );
}

export function WhatsappMock({
  contactName,
  contactSubtitle,
  messages,
  selectedIds = [],
  copied = false,
}: WhatsappMockProps) {
  const selected = new Set(selectedIds);
  return (
    <div aria-hidden className="relative w-full min-w-0 overflow-hidden">
      {selected.size > 0 ? (
        <SelectionBar count={selected.size} copied={copied} />
      ) : (
        <ContactBar name={contactName} subtitle={contactSubtitle} />
      )}
      <div className="flex flex-col gap-0.5 bg-[#efeae2] py-2 [background-image:radial-gradient(rgba(11,20,26,0.06)_1px,transparent_1px)] [background-size:12px_12px] dark:bg-[#0b141a] dark:[background-image:radial-gradient(rgba(233,237,239,0.05)_1px,transparent_1px)]">
        {messages.map((message) => (
          <Bubble key={message.id} message={message} selected={selected.has(message.id)} />
        ))}
      </div>
      {copied ? (
        <span
          data-slot="wa-toast"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-in rounded-full bg-[#111b21]/90 px-3 py-1 text-[10px] text-white duration-200 fade-in zoom-in-95"
        >
          Disalin
        </span>
      ) : null}
    </div>
  );
}
