import { useEffect, useRef, useCallback } from 'react'
import type { WSEvent } from '../types'

type Handler = (event: WSEvent) => void

/**
 * WebSocket hook with mobile-resilient reconnection.
 *
 * The previous version relied solely on the WebSocket's `onclose` event to
 * trigger reconnection. That works on desktop where backgrounded tabs keep
 * the socket alive, but mobile Safari and Chrome aggressively suspend
 * background WebSockets — sometimes without ever firing `onclose`. The tab
 * comes back to a "live" socket object that no longer talks to the server.
 *
 * Three defenses against that:
 *
 *   1. On `visibilitychange → visible`, ping the server. If no pong within
 *      ~5s, treat the connection as dead and reconnect.
 *
 *   2. Heartbeat ping every 30s while foregrounded. Detects silently-dead
 *      connections quickly so onmessage isn't waiting on traffic that will
 *      never come.
 *
 *   3. On every successful reconnect, fire a 'resync' event so the app can
 *      refetch state and catch up on anything that happened while we were
 *      offline (otherwise the dashboard is "live from now" with a gap).
 */
export function useWebSocket(onEvent: Handler) {
  const ws = useRef<WebSocket | null>(null)
  const handler = useRef(onEvent)
  handler.current = onEvent
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pongDeadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null }
    if (pongDeadline.current) { clearTimeout(pongDeadline.current); pongDeadline.current = null }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
  }, [])

  const teardown = useCallback(() => {
    clearTimers()
    if (ws.current) {
      try {
        ws.current.onclose = null
        ws.current.onerror = null
        ws.current.onmessage = null
        ws.current.close()
      } catch {}
      ws.current = null
    }
  }, [clearTimers])

  const scheduleReconnect = useCallback((delayMs: number) => {
    if (reconnectTimer.current) return // already scheduled
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      void connect()
    }, delayMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendPing = useCallback(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return
    try {
      ws.current.send(JSON.stringify({ type: 'ping' }))
    } catch {
      // Send failed — connection is bad. Force reconnect.
      teardown()
      scheduleReconnect(500)
      return
    }
    // If we don't get a pong (or any message) within 5s, treat as dead.
    if (pongDeadline.current) clearTimeout(pongDeadline.current)
    pongDeadline.current = setTimeout(() => {
      console.warn('[ws] no pong within 5s, reconnecting')
      teardown()
      scheduleReconnect(500)
    }, 5000)
  }, [teardown, scheduleReconnect])

  const connect = useCallback(async () => {
    teardown()

    // Browser WebSocket can't set custom headers on the handshake, so the
    // auth credential has to go in the URL. URLs end up in CDN/proxy access
    // logs, so we don't want our long-lived session token there. Instead:
    // exchange the session token for a single-use 10-second-TTL "ticket"
    // via the authenticated /ws-ticket endpoint, then put THAT in the URL.
    // Even if the log is somehow leaked, the ticket is already consumed and
    // expired.
    const token = localStorage.getItem('cereal_token')
    if (!token) return

    const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

    let ticket: string | null = null
    try {
      const resp = await fetch(`${apiBase}/ws-ticket`, {
        method: 'POST',
        headers: { 'x-session-token': token },
      })
      if (resp.ok) {
        const json = await resp.json()
        ticket = json.ticket
      }
    } catch {
      // Network blip — fall through to reconnect on close.
    }
    if (!ticket) {
      scheduleReconnect(3000)
      return
    }

    const wsUrl = apiBase
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
      + '/ws?ticket=' + encodeURIComponent(ticket)

    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      // Tell the app to refetch — catches anything we missed during the
      // disconnect window. The 'resync' event type isn't part of WSEvent's
      // wire format; we synthesize it locally so the app's WSEvent handler
      // can react to it the same way it reacts to server events.
      handler.current({ type: 'resync' } as unknown as WSEvent)

      // Start heartbeat. 30s is gentle on the network but fast enough that
      // a dead connection is detected within one minute.
      heartbeatTimer.current = setInterval(sendPing, 30_000)
    }

    socket.onmessage = (e) => {
      // Any message (including a pong) means the connection is alive —
      // cancel the pending pong-deadline timeout.
      if (pongDeadline.current) {
        clearTimeout(pongDeadline.current)
        pongDeadline.current = null
      }
      try {
        const event = JSON.parse(e.data)
        if (event?.type === 'pong') return // heartbeat reply, no app action
        handler.current(event as WSEvent)
      } catch {}
    }

    socket.onclose = () => {
      clearTimers()
      scheduleReconnect(3000)
    }

    socket.onerror = () => {
      try { socket.close() } catch {}
    }

    ws.current = socket
  }, [teardown, scheduleReconnect, sendPing])

  useEffect(() => {
    void connect()

    // Reconnect / health-check when the tab becomes visible. This is the
    // critical mobile fix — backgrounded tabs may have a zombie socket
    // that doesn't fire onclose but is also no longer transmitting.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
          void connect()
        } else {
          // Socket says it's open. Ping to verify.
          sendPing()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Also reconnect on network back-online events (e.g., wifi reconnect)
    function onOnline() {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        void connect()
      }
    }
    window.addEventListener('online', onOnline)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
