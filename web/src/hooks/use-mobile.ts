import * as React from "react"

import { VIEWPORT_MD } from "@/lib/layout"

const MOBILE_BREAKPOINT = VIEWPORT_MD

export function useIsMobile() {
  // Nilai awal dari viewport saat ini (bukan `undefined`): tanpa satu frame salah di ponsel (review M11).
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined" ? undefined : window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql?.addEventListener?.("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql?.removeEventListener?.("change", onChange)
  }, [])

  return !!isMobile
}
