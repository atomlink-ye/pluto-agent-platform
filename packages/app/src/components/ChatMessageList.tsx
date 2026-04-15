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
}

export function ChatMessageList({ items, isWorking, hasOlderHistory, isLoadingHistory, onLoadOlder }: ChatMessageListProps) {
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

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      {hasOlderHistory ? (
        <div className="flex justify-center pb-4">
          <Button variant="ghost" size="sm" onClick={onLoadOlder} loading={isLoadingHistory}>
            Load older messages
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => (
          <StreamItemRenderer key={item.id} item={item} />
        ))}
      </div>

      <WorkingIndicator visible={isWorking} />
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
