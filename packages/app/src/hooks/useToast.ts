import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { ToastContainer, type ToastRecord, type ToastVariant } from "../components/Toast"

interface ToastTriggerApi {
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
}

interface ToastContextValue {
  toast: ToastTriggerApi
}

const toastDurations: Record<ToastVariant, number | null> = {
  success: 4000,
  info: 4000,
  error: 8000,
  warning: null,
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

function generateToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)

    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }

    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (variant: ToastVariant, title: string, message?: string) => {
      const id = generateToastId()
      const nextToast: ToastRecord = { id, title, message, variant }

      setToasts((currentToasts) => [...currentToasts, nextToast])

      const duration = toastDurations[variant]
      if (duration !== null) {
        const timer = window.setTimeout(() => {
          dismiss(id)
        }, duration)

        timersRef.current.set(id, timer)
      }
    },
    [dismiss],
  )

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const toast = useMemo<ToastTriggerApi>(
    () => ({
      success: (title, message) => pushToast("success", title, message),
      error: (title, message) => pushToast("error", title, message),
      info: (title, message) => pushToast("info", title, message),
      warning: (title, message) => pushToast("warning", title, message),
    }),
    [pushToast],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast])

  return createElement(
    ToastContext.Provider,
    { value },
    children,
    createElement(ToastContainer, { toasts, onDismiss: dismiss }),
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }

  return context
}
