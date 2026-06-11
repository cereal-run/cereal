import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { searchAll } from '../api';
import { MessageViewer } from './MessageViewer';
export function GlobalSearch({ bowls, compact = false }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState(null);
    const inputRef = useRef(null);
    // Keyboard shortcut: Cmd/Ctrl + K opens search; Esc closes
    useEffect(() => {
        function handler(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen(o => !o);
            }
            if (e.key === 'Escape')
                setOpen(false);
        }
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
    // Focus input when opening
    useEffect(() => {
        if (open)
            setTimeout(() => inputRef.current?.focus(), 50);
        else {
            setQuery('');
            setResults([]);
        }
    }, [open]);
    // Debounced search
    useEffect(() => {
        if (!open)
            return;
        if (query.length < 2) {
            setResults([]);
            return;
        }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const res = await searchAll(query, 30);
                setResults(res.messages);
            }
            catch { }
            setSearching(false);
        }, 250);
        return () => clearTimeout(t);
    }, [query, open]);
    function bowlFor(message) {
        return bowls.find(b => b.id === message.bowlId);
    }
    function formatDate(ts) {
        const d = new Date(ts);
        const now = new Date();
        const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (days === 0)
            return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (days < 7)
            return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return (_jsxs(_Fragment, { children: [compact ? (_jsx("button", { onClick: () => setOpen(true), title: "Search", "aria-label": "Search", style: {
                    width: 36, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 100,
                    border: '1px solid transparent', background: 'transparent',
                    color: 'var(--text-3)', cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                }, children: _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("path", { d: "m21 21-4.3-4.3" })] }) })) : (_jsxs("button", { onClick: () => setOpen(true), title: "Search (\u2318K)", style: {
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 14px', borderRadius: 100,
                    border: '1px solid var(--border)', background: 'var(--bg-card)',
                    color: 'var(--text-3)', fontSize: '13px', cursor: 'text',
                    fontFamily: 'inherit', minWidth: 360,
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                }, onMouseOver: e => (e.currentTarget.style.borderColor = 'var(--border-med)'), onMouseOut: e => (e.currentTarget.style.borderColor = 'var(--border)'), children: [_jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("path", { d: "m21 21-4.3-4.3" })] }), _jsx("span", { style: { flex: 1, textAlign: 'left' }, children: "Search across all inboxes\u2026" }), _jsx("span", { style: {
                            fontSize: '11px', padding: '2px 6px', borderRadius: 4,
                            background: 'var(--bg)', border: '1px solid var(--border)',
                            color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums',
                            fontFamily: 'ui-monospace, monospace',
                        }, children: "\u2318K" })] })), open && (_jsx("div", { onClick: () => setOpen(false), style: {
                    position: 'fixed', inset: 0, zIndex: 100,
                    background: 'rgba(0,0,0,0.35)',
                    backdropFilter: 'blur(2px)',
                    animation: 'fadeIn 0.12s ease',
                } })), open && (_jsxs("div", { onClick: e => e.stopPropagation(), style: {
                    position: 'fixed', top: '10vh', left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(640px, 92vw)', zIndex: 101,
                    background: 'var(--bg)', borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                    overflow: 'hidden',
                    animation: 'slideDown 0.15s ease',
                }, children: [_jsxs("div", { style: {
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)',
                        }, children: [_jsx("span", { style: { fontSize: '1rem' }, children: "\uD83D\uDD0D" }), _jsx("input", { ref: inputRef, value: query, onChange: e => setQuery(e.target.value), placeholder: "Search across all bowls\u2026", style: {
                                    flex: 1, border: 'none', outline: 'none',
                                    background: 'transparent', fontSize: '0.95rem',
                                    color: 'var(--text-1)', fontFamily: 'inherit',
                                } }), searching && (_jsx("span", { style: { fontSize: '0.7rem', color: 'var(--text-3)' }, children: "Searching\u2026" })), _jsx("button", { onClick: () => setOpen(false), style: {
                                    background: 'none', cursor: 'pointer',
                                    fontSize: '0.7rem', color: 'var(--text-3)', padding: '0.2rem 0.5rem',
                                    borderRadius: 4, border: '1px solid var(--border)',
                                }, children: "esc" })] }), _jsxs("div", { style: { maxHeight: '60vh', overflowY: 'auto' }, children: [query.length < 2 && (_jsx("div", { style: { padding: '2rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }, children: "Start typing to search subjects, senders, and previews\u2026" })), query.length >= 2 && !searching && results.length === 0 && (_jsxs("div", { style: { padding: '2rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }, children: ["No matches for \"", query, "\""] })), results.map(msg => {
                                const bowl = bowlFor(msg);
                                return (_jsxs("button", { onClick: () => { setSelected(msg); setOpen(false); }, style: {
                                        width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                        padding: '0.7rem 1rem', border: 'none', borderBottom: '1px solid var(--border)',
                                        background: 'transparent', cursor: 'pointer', textAlign: 'left',
                                        fontFamily: 'inherit', transition: 'background 0.1s',
                                    }, onMouseOver: e => (e.currentTarget.style.background = 'var(--surface)'), onMouseOut: e => (e.currentTarget.style.background = 'transparent'), children: [_jsx("span", { style: {
                                                width: 10, height: 10, borderRadius: '50%',
                                                background: bowl?.color ?? 'var(--text-3)',
                                                flexShrink: 0,
                                            } }), _jsx("span", { style: {
                                                fontSize: '0.65rem', color: bowl?.color ?? 'var(--text-3)',
                                                fontWeight: 600, minWidth: 70, textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                            }, children: bowl?.name ?? 'inbox' }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: {
                                                        display: 'flex', alignItems: 'baseline', gap: '0.4rem',
                                                        fontSize: '0.78rem', color: 'var(--text-1)', fontWeight: msg.seen ? 400 : 600,
                                                    }, children: _jsx("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: msg.fromName || msg.fromEmail || 'Unknown' }) }), _jsx("div", { style: {
                                                        fontSize: '0.72rem', color: 'var(--text-2)',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        marginTop: 1,
                                                    }, children: msg.subject || '(no subject)' })] }), _jsx("span", { style: { fontSize: '0.65rem', color: 'var(--text-3)', flexShrink: 0 }, children: formatDate(msg.date) })] }, msg.id));
                            })] }), results.length > 0 && (_jsxs("div", { style: {
                            padding: '0.5rem 1rem', borderTop: '1px solid var(--border)',
                            fontSize: '0.65rem', color: 'var(--text-3)', textAlign: 'center',
                        }, children: [results.length, " result", results.length === 1 ? '' : 's', " \u00B7 Click to open"] }))] })), selected && (_jsx(MessageViewer, { message: selected, accentColor: bowlFor(selected)?.color ?? '#94a3b8', onClose: () => setSelected(null), onReply: () => { } }))] }));
}
