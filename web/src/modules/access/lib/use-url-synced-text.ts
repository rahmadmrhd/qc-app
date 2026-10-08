import { useEffect, useRef, useState } from 'react';

/**
 * Teks input yang dikirim ke URL setelah jeda (debounce) dan ikut berubah bila URL berubah dari luar
 * (mis. klik menu tanpa filter). `pushed` mengingat nilai terakhir yang dikirim, jadi gema dari URL
 * tidak dianggap perubahan luar, dan nilai lama tidak "hidup kembali" setelah URL dikosongkan.
 */
export function useUrlSyncedText(urlValue: string, commit: (value: string) => void, delayMs = 350) {
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
    if (text === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = text;
      commitRef.current(text);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs]);

  return [text, setText] as const;
}
