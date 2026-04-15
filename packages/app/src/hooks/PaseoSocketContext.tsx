import { createContext, useContext, useMemo, type ReactNode } from "react"
import { usePaseoSocket, type PaseoSocketHandle, type PaseoSocketOptions } from "./usePaseoSocket"

const PaseoSocketContext = createContext<PaseoSocketHandle | null>(null)

export function PaseoSocketProvider({ children, options }: { children: ReactNode; options?: PaseoSocketOptions }) {
  const handle = usePaseoSocket(options)
  const value = useMemo(
    () => handle,
    [handle.state, handle.sessionId, handle.daemonVersion, handle.send, handle.addListener],
  )
  return <PaseoSocketContext.Provider value={value}>{children}</PaseoSocketContext.Provider>
}

export function usePaseoSocketContext(): PaseoSocketHandle {
  const ctx = useContext(PaseoSocketContext)
  if (!ctx) {
    throw new Error("usePaseoSocketContext must be used within PaseoSocketProvider")
  }
  return ctx
}
