import { useEffect } from 'react'

export interface Shortcut {
  keys: string[]        // e.g. ['c'], ['Meta', 'k'], ['?']
  description: string
  handler: (e: KeyboardEvent) => void
  // If true, fires only when no input/textarea/contenteditable is focused
  guarded?: boolean
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

function matches(e: KeyboardEvent, keys: string[]): boolean {
  const required = keys.map(k => k.toLowerCase())
  const wantMeta = required.includes('meta') || required.includes('cmd')
  const wantCtrl = required.includes('ctrl')
  const wantShift = required.includes('shift')
  const wantAlt = required.includes('alt')
  const mainKey = required.filter(k => !['meta','cmd','ctrl','shift','alt'].includes(k))[0]

  if (wantMeta && !(e.metaKey || e.ctrlKey)) return false
  if (wantCtrl && !e.ctrlKey) return false
  if (wantShift !== e.shiftKey) return false
  if (wantAlt !== e.altKey) return false
  return e.key.toLowerCase() === mainKey
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const typing = isTyping(e.target)
      for (const s of shortcuts) {
        if (matches(e, s.keys)) {
          if (s.guarded && typing) continue
          e.preventDefault()
          s.handler(e)
          return
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}
