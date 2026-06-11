import type { WSEvent } from '../types.js'

// Minimal socket interface — covers what we use from either the 'ws' library
// or @fastify/websocket's SocketStream. Avoids needing @types/ws as a dep.
interface SocketLike {
  readyState: number
  send: (data: string) => void
}

// Each connected socket carries the user_id it was authenticated as.
// Broadcasts can target a specific user, defaulting to broadcast-all when
// no userId is provided (no current callers do, but the option exists).
interface Client {
  socket: SocketLike
  userId: string
}

const clients = new Set<Client>()

export function registerClient(socket: SocketLike, userId: string): void {
  clients.add({ socket, userId })
}

export function unregisterClient(socket: SocketLike): void {
  for (const c of clients) {
    if (c.socket === socket) {
      clients.delete(c)
      return
    }
  }
}

/**
 * Broadcast an event to connected sockets. If userId is provided, only
 * sockets authenticated as that user receive the message — this is the
 * per-user scoping that prevents cross-user leaks on the WS channel. If
 * userId is omitted, the broadcast goes to every connected socket (system
 * events, none currently — every caller should pass a userId).
 */
export function broadcast(event: WSEvent, userId?: string): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    if (userId && client.userId !== userId) continue
    // readyState 1 === OPEN (matches both the 'ws' library and the WebSocket spec)
    if (client.socket.readyState !== 1) continue
    try {
      client.socket.send(payload)
    } catch {
      // Socket died mid-send; the close handler will clean it up.
    }
  }
}
