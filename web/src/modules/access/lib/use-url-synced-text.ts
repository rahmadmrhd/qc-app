import { useEffect, useRef, useState } from 'react';

/**
 * Teks input yang dikirim ke URL setelah jeda (debounce) dan ikut berubah bila URL berubah dari luar
 * (mis. klik menu tanpa filter). `pushed` mengingat nilai terakhir yang dikirim, jadi gema dari URL
 * tidak dianggap perubahan luar, dan nilai lama tidak "hidup kembali" setelah URL dikosongkan.
 *
 * `normalize` (opsional): bentuk yang benar-benar dikirim ke URL oleh `commit` (mis. dipangkas atau dinormalkan). Gema URL
 * yang sama dengan `normalize(teks)` tidak dianggap perubahan luar, jadi teks mentah yang sedang diedit (baris baru di ujung,
 * baris yang belum sah, kelebihan batas) tidak ditimpa nilai URL yang sudah dinormalkan. Tanpa opsi ini teks dibandingkan apa adanya.
 */
export function useUrlSyncedText(
  urlValue: string,
  commit: (value: string) => void,
  delayMs = 350,
  { normalize }: { normalize?: (value: string) => string } = {},
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
    const comparable = normalize ? normalize(text) : text;
    if (comparable === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = comparable;
      commitRef.current(text);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs, normalize]);

  return [text, setText] as const;
}
