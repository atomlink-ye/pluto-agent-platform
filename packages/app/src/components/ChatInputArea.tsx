import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { SocketState } from "../hooks/usePaseoSocket"
import { Button } from "./Button"
import { getOperatorStatus, type OperatorAgentStatus } from "./RuntimeStatusBar"

export interface ChatInputAreaProps {
  disabled?: boolean
  agentStatus?: OperatorAgentStatus
  connectionState?: SocketState
  onSend: (text: string) => Promise<void>
}

function ConnectionBanner({ state }: { state: SocketState }) {
  if (state === "ready") return null

  const status = getOperatorStatus("idle", state)

  return (
    <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
      {status.label}
    </div>
  )
}

export function ChatInputArea({ disabled, agentStatus, connectionState = "ready", onSend }: ChatInputAreaProps) {
  const [text, setText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (sendErrorTimeoutRef.current) {
        clearTimeout(sendErrorTimeoutRef.current)
      }
    }
  }, [])

  const showSendError = useCallback(() => {
    if (sendErrorTimeoutRef.current) {
      clearTimeout(sendErrorTimeoutRef.current)
    }

    setSendError("Failed to send message. Try again.")
    sendErrorTimeoutRef.current = setTimeout(() => setSendError(null), 5000)
  }, [])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeight = 6 * 24
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isSending || disabled) return

    setIsSending(true)
    setSendError(null)

    try {
      await onSend(trimmed)
      setText("")
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    } catch {
      showSendError()
    } finally {
      setIsSending(false)
    }
  }, [text, isSending, disabled, onSend, showSendError])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isDisabled = disabled || connectionState !== "ready" || agentStatus === "done" || agentStatus === "error"
  const disabledReason = connectionState !== "ready"
    ? "Cannot send — connection not established"
    : agentStatus === "done"
      ? "Cannot send — agent has completed"
      : agentStatus === "error"
        ? "Cannot send — agent encountered an error"
        : null

  return (
    <div className="border-t border-slate-200 bg-white">
      <ConnectionBanner state={connectionState} />
      <div className="px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); adjustHeight() }}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            disabled={isDisabled}
            rows={1}
            className={`flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDisabled ? "cursor-not-allowed bg-slate-100 opacity-50" : "bg-white"}`}
            style={{ resize: "none" }}
          />
          <Button
            onClick={handleSend}
            disabled={isDisabled || !text.trim() || isSending}
            loading={isSending}
            className="px-3"
            aria-label="Send message"
          >
            {!isSending ? (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            ) : null}
          </Button>
        </div>
        {disabledReason ? <p className="mt-2 text-xs text-slate-500">{disabledReason}</p> : null}
        {sendError ? <p className="mt-2 text-xs text-red-500">{sendError}</p> : null}
      </div>
    </div>
  )
}
