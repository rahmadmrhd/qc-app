import {
  MAIL_LIST_FIELDS,
  MAIL_LIST_LABELS,
  type MailListField,
  type MailLists,
} from '@shared/mail-lists';
import { isPostelRecipient } from '@shared/postel';
import { useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';

/** Saran penerima dari daftar pengguna (opsional); alamat lain tetap dapat diketik. */
export interface RecipientSuggestion {
  name: string;
  email: string;
  /** `false` = tidak ditawarkan sebagai saran (mis. akun nonaktif). */
  active?: boolean;
}

export interface MailListsFieldsProps {
  /** Awalan id field (`<awalan>-recipients`, `-cc`, `-bcc`). */
  idPrefix: string;
  value: MailLists;
  onChange: (next: MailLists) => void;
  /** Daftar pengguna untuk saran; `null`/tak ada = hanya ketik alamat. */
  suggestions?: readonly RecipientSuggestion[] | null | undefined;
  /** Batas alamat per daftar. */
  max: number;
  errors?: Partial<Record<MailListField, string | undefined>> | undefined;
  /** Daftar Kepada (To) diberi tanda wajib (mis. laporan terjadwal yang butuh minimal satu penerima). */
  requiredTo?: boolean;
  disabled?: boolean;
  /** Teks bantu di bawah daftar Kepada. */
  toHint?: string;
}

const MAX_SUGGESTIONS = 50;

function suggestionLabel(user: RecipientSuggestion): string {
  return `${user.name} (${user.email})`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

interface ListFieldProps {
  id: string;
  field: MailListField;
  value: MailLists;
  onChange: (next: MailLists) => void;
  suggestions: readonly RecipientSuggestion[];
  max: number;
  error: string | undefined;
  required: boolean;
  disabled: boolean;
  hint: string | undefined;
}

/**
 * Satu daftar penerima: nilai terpilih tampil sebagai chip di dalam bingkai input (pola `LinkMultiField`), dan alamat
 * yang diketik menjadi chip saat Enter ditekan (atau dipilih dari daftar saran). Alamat tak sah tak pernah menjadi chip;
 * alamat yang sudah ada di salah satu dari ketiga daftar tidak ditawarkan lagi.
 */
function RecipientList({
  id,
  field,
  value,
  onChange,
  suggestions,
  max,
  error,
  required,
  disabled,
  hint,
}: ListFieldProps) {
  const [term, setTerm] = useState('');
  const chosenAll = new Set([...value.recipients, ...value.cc, ...value.bcc]);
  const termText = normalize(term);
  const matches = suggestions
    .filter((user) => user.active !== false && !chosenAll.has(user.email.toLowerCase()))
    .filter(
      (user) => termText === '' || `${user.name} ${user.email}`.toLowerCase().includes(termText),
    )
    .slice(0, MAX_SUGGESTIONS);
  const options: LinkOption[] = matches.map((user) => ({
    id: user.email.toLowerCase(),
    label: suggestionLabel(user),
  }));
  const typedIsEmail = termText !== '' && isPostelRecipient(termText);
  // Alamat yang diketik ditawarkan PERTAMA agar Enter langsung memilihnya (kecuali sudah ada sebagai saran persis).
  if (
    typedIsEmail &&
    !chosenAll.has(termText) &&
    !options.some((option) => option.id === termText)
  ) {
    options.unshift({ id: termText, label: termText });
  }
  const byEmail = new Map(suggestions.map((user) => [user.email.toLowerCase(), user]));
  const typedProblem =
    termText !== '' && !typedIsEmail && options.length === 0
      ? 'Ketik alamat email lengkap, lalu tekan Enter'
      : null;
  const message = error ?? typedProblem ?? undefined;
  return (
    <div className="space-y-1">
      <LinkMultiField
        id={id}
        label={MAIL_LIST_LABELS[field]}
        placeholder="Ketik email lalu Enter, atau pilih pengguna"
        value={value[field]}
        labelOf={(email) => {
          const user = byEmail.get(email);
          return user ? suggestionLabel(user) : email;
        }}
        options={options}
        onSearchChange={setTerm}
        searchDebounceMs={0}
        maxSelected={max}
        required={required}
        disabled={disabled}
        {...(message === undefined ? {} : { error: message })}
        onChange={(ids) => onChange({ ...value, [field]: ids })}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Tiga daftar penerima surel yang dapat dikonfigurasi (keputusan pemilik 2026-11-25): Kepada (To), Tembusan (CC), dan
 * Tembusan tersembunyi (BCC). Dipakai SEMUA pengaturan pengiriman surel agar perilakunya seragam.
 */
export function MailListsFields({
  idPrefix,
  value,
  onChange,
  suggestions,
  max,
  errors,
  requiredTo = false,
  disabled = false,
  toHint,
}: MailListsFieldsProps) {
  const list = suggestions ?? [];
  return (
    <div className="space-y-3">
      {MAIL_LIST_FIELDS.map((field) => (
        <RecipientList
          key={field}
          id={`${idPrefix}-${field}`}
          field={field}
          value={value}
          onChange={onChange}
          suggestions={list}
          max={max}
          error={errors?.[field]}
          required={field === 'recipients' && requiredTo}
          disabled={disabled}
          hint={field === 'recipients' ? toHint : undefined}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Maksimal {max} alamat per daftar. CC terlihat oleh penerima lain; BCC tidak. Satu alamat
        hanya boleh ada di satu daftar.
      </p>
    </div>
  );
}
