import { useEffect, useRef, useState } from "react"
import type { StreamItem } from "../types/paseo"
import { StreamItemRenderer } from "./StreamItemRenderer"
import { WorkingIndicator } from "./WorkingIndicator"
import { Button } from "./Button"

export interface ChatMessageListProps {
  items: StreamItem[]
  isWorking: boolean
  hasOlderHistory: boolean
  isLoadingHistory: boolean
  onLoadOlder: () => void
  dark?: boolean
}

function EmptyState({ dark, isLoading }: { dark?: boolean; isLoading: boolean }) {
  if (isLoading) {
    const skeletonClass = dark
      ? "rounded-lg bg-slate-800 animate-pulse"
      : "rounded-lg bg-slate-100 animate-pulse"
    return (
      <div className="flex flex-col gap-4 py-8 px-4">
        <div className={`${skeletonClass} h-12 w-3/4`} />
        <div className={`${skeletonClass} h-8 w-1/2 self-end`} />
        <div className={`${skeletonClass} h-16 w-2/3`} />
      </div>
    )
  }

  const iconClass = dark ? "text-slate-600" : "text-slate-300"
  const textClass = dark ? "text-sm text-slate-400" : "text-sm text-slate-500"

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <svg className={`h-10 w-10 ${iconClass}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
      <p className={textClass}>No messages yet</p>
    </div>
  )
}

export function ChatMessageList({ items, isWorking, hasOlderHistory, isLoadingHistory, onLoadOlder, dark }: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleScroll = () => {
      const threshold = 100
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
      setIsNearBottom(nearBottom)
      setShowJumpButton(!nearBottom)
    }
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    if (isNearBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [items.length, isNearBottom])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  if (items.length === 0 && !isWorking) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
        <EmptyState dark={dark} isLoading={isLoadingHistory} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      {hasOlderHistory ? (
        <div className="flex justify-center pb-4">
          <Button variant="ghost" size="sm" onClick={onLoadOlder} loading={isLoadingHistory}>
            Load older messages
          </Button>
        </div>
      ) : null}

      <div className="space-y-4">
        {items.map((item) => (
          <StreamItemRenderer key={item.id} item={item} dark={dark} />
        ))}
      </div>

      <WorkingIndicator visible={isWorking} dark={dark} />
      <div ref={bottomRef} />

      {showJumpButton ? (
        <div className="sticky bottom-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={scrollToBottom} className="rounded-full shadow-md">
            &#8595; Jump to bottom
          </Button>
        </div>
      ) : null}
    </div>
  )
}
