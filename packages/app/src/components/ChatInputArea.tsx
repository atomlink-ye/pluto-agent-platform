import { useCallback, useRef, useState, type KeyboardEvent } from "react"
import type { SocketState } from "../hooks/usePaseoSocket"

export interface ChatInputAreaProps {
  disabled?: boolean
  connectionState?: SocketState
  onSend: (text: string) => Promise<void>
}

function ConnectionBanner({ state }: { state: SocketState }) {
  if (state === "ready") return null
  const messages: Record<string, string> = {
    connecting: "Connecting to agent...",
    handshaking: "Establishing connection...",
    reconnecting: "Reconnecting...",
    error: "Connection error \u2014 messages cannot be sent",
    closed: "Connection closed",
  }
  return (
    <div className="mx-4 mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
      {messages[state] ?? "Connecting..."}
    </div>
  )
}

export function ChatInputArea({ disabled, connectionState = "ready", onSend }: ChatInputAreaProps) {
  const [text, setText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeight = 6 * 24 // ~6 lines
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isSending || disabled) return
    setIsSending(true)
    try {
      await onSend(trimmed)
      setText("")
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    } finally {
      setIsSending(false)
    }
  }, [text, isSending, disabled, onSend])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isDisabled = disabled || connectionState !== "ready"

  return (
    <div className="border-t border-slate-200 bg-white">
      <ConnectionBanner state={connectionState} />
      <div className="flex items-end gap-2 px-4 py-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); adjustHeight() }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={isDisabled}
          rows={1}
          className={`flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${isDisabled ? "opacity-50 cursor-not-allowed bg-slate-100" : "bg-white"}`}
          style={{ resize: "none" }}
        />
        <button
          onClick={handleSend}
          disabled={isDisabled || !text.trim() || isSending}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSending ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
