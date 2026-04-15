import { useEffect } from "react"

export function usePolling(fetchFn: () => void | Promise<unknown>, intervalMs: number, active: boolean) {
  useEffect(() => {
    if (!active) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void fetchFn()
      }
    }, intervalMs)

    return () => window.clearInterval(intervalId)
  }, [active, fetchFn, intervalMs])
}
