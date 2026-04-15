import { useCallback, useEffect, useRef, useState } from "react"
import type { WsClientMessage, WsServerMessage, WsWelcome } from "../types/paseo"

export type SocketState = "connecting" | "handshaking" | "ready" | "reconnecting" | "error" | "closed"

export interface PaseoSocketOptions {
  url?: string
  clientId?: string
  reconnectDelayMs?: number
}

export interface PaseoSocketHandle {
  state: SocketState
  sessionId: string | null
  daemonVersion: string | null
  send: (msg: WsClientMessage) => void
  addListener: (type: string, handler: (msg: WsServerMessage) => void) => () => void
}

const DEFAULT_URL = "ws://127.0.0.1:6767/ws"
const DEFAULT_RECONNECT_DELAY = 2000
const MAX_RECONNECT_DELAY = 30000
const HANDSHAKE_TIMEOUT = 5000

function getOrCreateClientId(provided?: string): string {
  if (provided) return provided
  const key = "pluto-client-id"
  let stored = sessionStorage.getItem(key)
  if (!stored) {
    stored = crypto.randomUUID()
    sessionStorage.setItem(key, stored)
  }
  return stored
}

export function usePaseoSocket(options?: PaseoSocketOptions): PaseoSocketHandle {
  const url = options?.url ?? DEFAULT_URL
  const baseDelay = options?.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY
  const clientIdRef = useRef(getOrCreateClientId(options?.clientId))

  const [state, setState] = useState<SocketState>("connecting")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [daemonVersion, setDaemonVersion] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef<Map<string, Set<(msg: WsServerMessage) => void>>>(new Map())
  const reconnectDelayRef = useRef(baseDelay)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handshakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  const addListener = useCallback((type: string, handler: (msg: WsServerMessage) => void): (() => void) => {
    const map = listenersRef.current
    if (!map.has(type)) {
      map.set(type, new Set())
    }
    map.get(type)!.add(handler)
    return () => {
      const set = map.get(type)
      if (set) {
        set.delete(handler)
        if (set.size === 0) map.delete(type)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    function connect() {
      if (!mountedRef.current) return

      const ws = new WebSocket(url)
      wsRef.current = ws
      setState("connecting")

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return }
        setState("handshaking")
        const hello: WsClientMessage = {
          type: "ws_hello",
          id: crypto.randomUUID(),
          clientId: clientIdRef.current,
          version: "1",
          timestamp: Date.now(),
        }
        ws.send(JSON.stringify(hello))

        handshakeTimerRef.current = setTimeout(() => {
          if (mountedRef.current && ws.readyState === WebSocket.OPEN) {
            ws.close()
          }
        }, HANDSHAKE_TIMEOUT)
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        let msg: WsServerMessage
        try {
          msg = JSON.parse(event.data as string) as WsServerMessage
        } catch {
          return
        }

        if (msg.type === "ws_welcome") {
          if (handshakeTimerRef.current) {
            clearTimeout(handshakeTimerRef.current)
            handshakeTimerRef.current = null
          }
          const welcome = msg as WsWelcome
          setSessionId(welcome.sessionId)
          setDaemonVersion(welcome.daemonVersion)
          setState("ready")
          reconnectDelayRef.current = baseDelay
        }

        const handlers = listenersRef.current.get(msg.type)
        if (handlers) {
          for (const handler of handlers) {
            handler(msg)
          }
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        if (handshakeTimerRef.current) {
          clearTimeout(handshakeTimerRef.current)
          handshakeTimerRef.current = null
        }
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose will fire after onerror
      }
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return
      setState("reconnecting")
      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (handshakeTimerRef.current) clearTimeout(handshakeTimerRef.current)
      const ws = wsRef.current
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
      setState("closed")
    }
  }, [url, baseDelay])

  return { state, sessionId, daemonVersion, send, addListener }
}
