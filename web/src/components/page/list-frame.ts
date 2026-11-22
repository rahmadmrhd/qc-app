import { createContext } from 'react';

/**
 * `ListPage` menyediakannya: tabel (`DataTable`) di dalam halaman daftar mengisi sisa viewport (`fit="viewport"`),
 * sedangkan tabel yang tertanam di tempat lain (mis. tab View, dialog) hanya menggulir horizontal (`fit="content"`).
 */
export const ListFrameContext = createContext(false);
