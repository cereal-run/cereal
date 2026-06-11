import { useEffect } from 'react';
function isTyping(target) {
    if (!(target instanceof HTMLElement))
        return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
        return true;
    if (target.isContentEditable)
        return true;
    return false;
}
function matches(e, keys) {
    const required = keys.map(k => k.toLowerCase());
    const wantMeta = required.includes('meta') || required.includes('cmd');
    const wantCtrl = required.includes('ctrl');
    const wantShift = required.includes('shift');
    const wantAlt = required.includes('alt');
    const mainKey = required.filter(k => !['meta', 'cmd', 'ctrl', 'shift', 'alt'].includes(k))[0];
    if (wantMeta && !(e.metaKey || e.ctrlKey))
        return false;
    if (wantCtrl && !e.ctrlKey)
        return false;
    if (wantShift !== e.shiftKey)
        return false;
    if (wantAlt !== e.altKey)
        return false;
    return e.key.toLowerCase() === mainKey;
}
export function useKeyboardShortcuts(shortcuts) {
    useEffect(() => {
        function handler(e) {
            const typing = isTyping(e.target);
            for (const s of shortcuts) {
                if (matches(e, s.keys)) {
                    if (s.guarded && typing)
                        continue;
                    e.preventDefault();
                    s.handler(e);
                    return;
                }
            }
        }
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [shortcuts]);
}
