import { useEffect, useRef, useState } from 'react';

/**
 * Teks input yang dikirim ke URL setelah jeda (debounce) dan ikut berubah bila URL berubah dari luar
 * (mis. klik menu tanpa filter). `pushed` mengingat nilai terakhir yang dikirim, jadi gema dari URL
 * tidak dianggap perubahan luar, dan nilai lama tidak "hidup kembali" setelah URL dikosongkan.
 *
 * `ignoreTrailingWhitespace`: spasi/baris baru di ujung teks tidak dihitung (nilai di URL biasanya sudah dipangkas), jadi
 * baris baru yang baru diketik atau di-Enter tidak dihapus oleh gema URL; tanpa ini kursor kembali ke baris sebelumnya.
 */
export function useUrlSyncedText(
  urlValue: string,
  commit: (value: string) => void,
  delayMs = 350,
  { ignoreTrailingWhitespace = false }: { ignoreTrailingWhitespace?: boolean } = {},
) {
  const [text, setText] = useState(urlValue);
  const pushed = useRef(urlValue);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (urlValue === pushed.current) return;
    pushed.current = urlValue;
    setText(urlValue);
  }, [urlValue]);

  useEffect(() => {
    const comparable = ignoreTrailingWhitespace ? text.trimEnd() : text;
    if (comparable === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = comparable;
      commitRef.current(text);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs, ignoreTrailingWhitespace]);

  return [text, setText] as const;
}
