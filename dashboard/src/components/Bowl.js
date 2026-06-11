import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { getMessages, getAgentMessages, sendToAgent, resolveDecision, updateBowl, deleteBowl, resyncBowl } from '../api';
import { EmailCard } from './EmailCard';
import { AgentCard } from './AgentCard';
import { SpamVerificationCard } from './SpamVerificationCard';
import { MessageViewer } from './MessageViewer';
import { ComposeModal } from './ComposeModal';
import { ComposeIcon, ArrowRightIcon } from './Icons';
import styles from './Bowl.module.css';
const COLORS = ['#ff6b35', '#f72585', '#7b2fff', '#3a86ff'];
export function BowlCard({ bowl, refreshTrigger, onNewMessage, onUpdate, onDelete }) {
    const [messages, setMessages] = useState([]);
    const [agentMessages, setAgentMessages] = useState([]);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [replyToMessage, setReplyToMessage] = useState(null);
    const [forwardData, setForwardData] = useState(null);
    const [composing, setComposing] = useState(false);
    const [agentInput, setAgentInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const PAGE_SIZE = 12;
    const isAgent = bowl.id === 'agent' || bowl.name.toLowerCase() === 'agent';
    const loadMessages = useCallback(async () => {
        try {
            if (isAgent) {
                const { messages: msgs } = await getAgentMessages(bowl.id, 20);
                setAgentMessages(msgs.reverse());
            }
            else {
                const { messages: msgs } = await getMessages(bowl.id, { limit: PAGE_SIZE });
                setMessages(msgs);
                setHasMore(msgs.length === PAGE_SIZE);
            }
        }
        catch { }
        setLoading(false);
    }, [bowl.id, isAgent]);
    // Refresh button: trigger a server-side IMAP sync (pulls new mail from the
    // mail server), then reload from the DB. New messages also arrive via WS,
    // but reloading guarantees the list reflects the sync even if a WS event
    // was missed. The spinner runs for the whole round-trip so the button
    // never feels dead.
    async function handleRefresh() {
        if (refreshing)
            return;
        setRefreshing(true);
        try {
            if (!isAgent) {
                await resyncBowl(bowl.id).catch(() => { }); // best-effort; reload regardless
            }
            await loadMessages();
        }
        finally {
            setRefreshing(false);
        }
    }
    async function loadMore() {
        if (loadingMore || isAgent)
            return;
        setLoadingMore(true);
        try {
            const { messages: msgs } = await getMessages(bowl.id, {
                limit: PAGE_SIZE,
                offset: messages.length,
            });
            if (msgs.length > 0) {
                // Dedupe by id in case of overlap
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m.id));
                    const newOnes = msgs.filter(m => !existingIds.has(m.id));
                    return [...prev, ...newOnes];
                });
            }
            setHasMore(msgs.length === PAGE_SIZE);
        }
        catch { }
        setLoadingMore(false);
    }
    useEffect(() => { loadMessages(); }, [loadMessages]);
    useEffect(() => { if (onNewMessage)
        loadMessages(); }, [onNewMessage, loadMessages]);
    // WebSocket triggers: reload messages without setting loading=true (no flash)
    useEffect(() => {
        if (refreshTrigger && refreshTrigger > 0) {
            const silentLoad = async () => {
                try {
                    if (isAgent) {
                        const { messages: msgs } = await getAgentMessages(bowl.id, 20);
                        setAgentMessages(msgs.reverse());
                    }
                    else {
                        // Reload current page count to keep what's already shown
                        const currentCount = Math.max(messages.length, PAGE_SIZE);
                        const { messages: msgs } = await getMessages(bowl.id, { limit: currentCount });
                        setMessages(msgs);
                        setHasMore(msgs.length === currentCount);
                    }
                }
                catch { }
            };
            silentLoad();
        }
    }, [refreshTrigger, bowl.id, isAgent]);
    const unreadCount = bowl.unreadCount ?? messages.filter(m => !m.seen).length;
    async function handleAgentSend() {
        if (!agentInput.trim())
            return;
        try {
            await sendToAgent('agent', agentInput, bowl.id);
            setAgentInput('');
            loadMessages();
        }
        catch { }
    }
    async function handleResolve(id, resolution) {
        await resolveDecision(id, resolution);
        loadMessages();
    }
    function handleReply(message) {
        setReplyToMessage(message);
        setForwardData(null);
        setSelectedMessage(null);
        setComposing(true);
    }
    function handleForward(message, body) {
        // Strip HTML tags for the forwarded body (use plain if available, else strip html)
        const bodyText = body.textPlain ?? (body.textHtml ? stripHtml(body.textHtml) : '');
        setForwardData({
            fromEmail: message.fromEmail,
            fromName: message.fromName,
            subject: message.subject,
            date: message.date,
            body: bodyText,
        });
        setReplyToMessage(null);
        setSelectedMessage(null);
        setComposing(true);
    }
    function handleCompose() {
        setReplyToMessage(null);
        setForwardData(null);
        setComposing(true);
    }
    function handleCloseCom() {
        setComposing(false);
        setReplyToMessage(null);
        setForwardData(null);
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.bowl, "data-bowl-id": bowl.id, tabIndex: -1, style: {
                    ['--bowl-color']: bowl.color,
                    ...(isAgent ? {
                        background: '#1c1a17',
                        color: '#e8e3da',
                        fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
                        borderColor: 'rgba(255,255,255,0.06)',
                    } : {}),
                }, children: [_jsxs("div", { className: styles.header, style: isAgent ? {
                            background: '#0f0e0c',
                            borderBottomColor: 'rgba(255,255,255,0.06)',
                        } : undefined, children: [!isAgent && (_jsx("span", { className: styles.headerDot, style: { color: bowl.color }, "aria-hidden": "true" })), _jsx("span", { className: styles.name, style: isAgent ? { color: '#06d6a0' } : undefined, children: isAgent ? '▸ agent' : bowl.name }), unreadCount > 0 && (_jsx("span", { className: styles.badge, style: {
                                    background: `${bowl.color}26`,
                                    color: bowl.color,
                                }, children: unreadCount })), _jsx("div", { style: { flex: 1 } }), _jsx("button", { className: styles.composeBtn, onClick: handleRefresh, disabled: refreshing, title: "Refresh", children: _jsxs("svg", { className: refreshing ? styles.spinning : undefined, width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M21 12a9 9 0 1 1-3-6.7L21 8" }), _jsx("path", { d: "M21 3v5h-5" })] }) }), !bowl.isSpam && !isAgent && (_jsx("button", { className: styles.composeBtn, onClick: handleCompose, title: "Compose", children: _jsx(ComposeIcon, { size: 13, color: "currentColor" }) })), _jsx("button", { className: styles.composeBtn, onClick: () => setSettingsOpen(!settingsOpen), title: "Bowl settings", children: _jsxs("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "currentColor", children: [_jsx("circle", { cx: "12", cy: "5", r: "1.7" }), _jsx("circle", { cx: "12", cy: "12", r: "1.7" }), _jsx("circle", { cx: "12", cy: "19", r: "1.7" })] }) })] }), settingsOpen && (_jsx(BowlSettings, { bowl: bowl, onClose: () => setSettingsOpen(false), onUpdate: onUpdate, onDelete: onDelete })), _jsxs("div", { className: styles.messages, children: [loading && _jsx("div", { className: styles.loader }), !loading && isAgent && agentMessages.map(msg => (_jsx(AgentCard, { message: msg, accentColor: bowl.color, onResolve: handleResolve }, msg.id))), !loading && !isAgent && bowl.isSpam && (() => {
                                // The most recent message is most likely the one with the code you want
                                // SpamVerificationCard renders nothing if no code is found
                                const newest = messages[0];
                                const rest = messages.slice(1);
                                return (_jsxs(_Fragment, { children: [newest && _jsx(SpamVerificationCard, { message: newest, onClick: () => setSelectedMessage(newest) }), newest && (_jsx(EmailCard, { message: newest, accentColor: bowl.color, onClick: () => setSelectedMessage(newest), isSpam: true }, newest.id)), rest.map(msg => (_jsx(EmailCard, { message: msg, accentColor: bowl.color, onClick: () => setSelectedMessage(msg), isSpam: true }, msg.id)))] }));
                            })(), !loading && !isAgent && !bowl.isSpam && messages.map(msg => (_jsx(EmailCard, { message: msg, accentColor: bowl.color, onClick: () => setSelectedMessage(msg) }, msg.id))), !loading && messages.length === 0 && !isAgent && (_jsx("div", { className: styles.empty, children: "All clear" }))] }), isAgent && (_jsxs("div", { className: styles.agentInput, style: { borderTopColor: 'rgba(255,255,255,0.06)' }, children: [_jsx("input", { className: styles.agentTextField, value: agentInput, onChange: e => setAgentInput(e.target.value), placeholder: "Message agent\u2026", onKeyDown: e => e.key === 'Enter' && handleAgentSend(), style: {
                                    background: '#0f0e0c',
                                    color: '#e8e3da',
                                    borderColor: 'rgba(255,255,255,0.08)',
                                    fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
                                    fontSize: '12px',
                                } }), _jsx("button", { className: styles.agentSendBtn, style: {
                                    background: 'transparent',
                                    borderColor: 'rgba(255,255,255,0.08)',
                                    color: '#06d6a0',
                                }, onClick: handleAgentSend, children: _jsx(ArrowRightIcon, { size: 11, color: "#06d6a0" }) })] })), !isAgent && messages.length > 0 && hasMore && (_jsxs("button", { onClick: loadMore, disabled: loadingMore, className: styles.viewAll, style: {
                            color: bowl.color,
                            border: 'none',
                            background: 'transparent',
                            cursor: loadingMore ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            opacity: loadingMore ? 0.5 : 1,
                            width: '100%',
                        }, children: [_jsx("span", { children: loadingMore ? 'Loading…' : 'Load more' }), _jsx("span", { className: styles.viewAllCount, children: loadingMore ? '' : `${messages.length} shown` })] })), !isAgent && messages.length > 0 && !hasMore && (_jsxs("div", { className: styles.viewAll, style: { color: 'var(--text-3)', opacity: 0.5 }, children: [_jsx("span", { children: "That's everything" }), _jsxs("span", { className: styles.viewAllCount, children: [messages.length, " total"] })] }))] }), selectedMessage && (_jsx(MessageViewer, { message: selectedMessage, accentColor: bowl.color, onClose: () => setSelectedMessage(null), onReply: () => handleReply(selectedMessage), onForward: (body) => handleForward(selectedMessage, body) })), composing && (_jsx(ComposeModal, { bowl: bowl, replyTo: replyToMessage ? {
                    fromEmail: replyToMessage.fromEmail,
                    fromName: replyToMessage.fromName,
                    subject: replyToMessage.subject,
                    messageId: replyToMessage.messageId ?? null,
                } : undefined, forward: forwardData ?? undefined, onClose: handleCloseCom, onSent: () => { handleCloseCom(); loadMessages(); } }))] }));
}
// ── Inline bowl settings ────────────────────────────────────────────────────
function BowlSettings({ bowl, onClose, onUpdate, onDelete }) {
    const [name, setName] = useState(bowl.name);
    const [color, setColor] = useState(bowl.color);
    const [defaultFrom, setDefaultFrom] = useState(bowl.defaultFrom ?? '');
    const [addresses, setAddresses] = useState(bowl.addresses);
    const [newAddr, setNewAddr] = useState('');
    const [addrError, setAddrError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    function saveName() {
        if (name.trim() && name !== bowl.name) {
            updateBowl(bowl.id, { name: name.trim() }).catch(() => { });
            onUpdate?.(bowl.id, { name: name.trim() });
        }
    }
    function saveColor(c) {
        setColor(c);
        updateBowl(bowl.id, { color: c }).catch(() => { });
        onUpdate?.(bowl.id, { color: c });
    }
    function saveDefaultFrom(addr) {
        setDefaultFrom(addr);
        updateBowl(bowl.id, { defaultFrom: addr || undefined }).catch(() => { });
        onUpdate?.(bowl.id, { defaultFrom: addr || null });
    }
    function addAddress() {
        // Split on commas, newlines, semicolons, or whitespace so users can paste
        // a batch (e.g. from a contacts export). Spaces alone aren't a delimiter
        // since they show up inside display names sometimes, but for a pure
        // email-address field whitespace is safe.
        const tokens = newAddr
            .split(/[,;\n\s]+/)
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);
        if (tokens.length === 0)
            return;
        const valid = [];
        const invalid = [];
        for (const addr of tokens) {
            if (!addr.includes('@') || !addr.split('@')[1]?.includes('.')) {
                invalid.push(addr);
                continue;
            }
            if (addresses.includes(addr) || valid.includes(addr))
                continue;
            valid.push(addr);
        }
        if (invalid.length > 0 && valid.length === 0) {
            setAddrError(`Not valid: ${invalid.join(', ')}`);
            return;
        }
        if (valid.length === 0) {
            setAddrError('Already added.');
            return;
        }
        const next = [...addresses, ...valid];
        setAddresses(next);
        const newDefault = defaultFrom || valid[0];
        if (!defaultFrom)
            setDefaultFrom(newDefault);
        setNewAddr('');
        setAddrError(invalid.length > 0 ? `Added ${valid.length}, skipped invalid: ${invalid.join(', ')}` : '');
        updateBowl(bowl.id, { addresses: next, defaultFrom: newDefault }).catch(() => { });
        onUpdate?.(bowl.id, { addresses: next, defaultFrom: newDefault });
    }
    function removeAddress(addr) {
        const next = addresses.filter(a => a !== addr);
        setAddresses(next);
        const newDefault = defaultFrom === addr ? (next[0] ?? '') : defaultFrom;
        setDefaultFrom(newDefault);
        updateBowl(bowl.id, { addresses: next, defaultFrom: newDefault || undefined }).catch(() => { });
        onUpdate?.(bowl.id, { addresses: next, defaultFrom: newDefault || null });
    }
    function handleDelete() {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        deleteBowl(bowl.id)
            .then(() => { onDelete?.(bowl.id); })
            .catch((err) => {
            // Show the error inline so the user sees something happened.
            setAddrError(`Delete failed: ${err.message}`);
            setConfirmDelete(false);
        });
    }
    return (_jsxs("div", { style: {
            // Cover the entire bowl card as an in-place overlay. This sidesteps
            // the bowl's overflow:hidden clipping — when the settings panel is
            // taller than the bowl height, it scrolls internally instead of
            // being cut off at the bottom.
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            padding: '14px 16px',
            background: 'var(--bg-card)',
            fontSize: 12,
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            color: 'var(--text-1)',
            overflowY: 'auto',
            animation: 'fadeIn 0.15s ease',
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [_jsx("span", { style: { fontWeight: 600, color: 'var(--text-1)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }, children: "Bowl settings" }), _jsx("button", { onClick: onClose, style: {
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            color: 'var(--text-3)', fontSize: 13, padding: 0, lineHeight: 1,
                            fontFamily: 'inherit',
                        }, children: "\u2715" })] }), _jsxs("div", { style: { marginBottom: 9 }, children: [_jsx("label", { style: { fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 3 }, children: "Name" }), _jsx("input", { value: name, onChange: e => setName(e.target.value), onBlur: saveName, onKeyDown: e => e.key === 'Enter' && saveName(), style: inputStyle })] }), _jsxs("div", { style: { marginBottom: 9 }, children: [_jsx("label", { style: { fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 3 }, children: "Reply from" }), addresses.length > 0 ? (_jsx("select", { value: defaultFrom, onChange: e => saveDefaultFrom(e.target.value), style: { ...inputStyle, cursor: 'pointer' }, children: addresses.map(addr => (_jsx("option", { value: addr, children: addr }, addr))) })) : (_jsx("div", { style: { fontSize: 11, color: 'var(--text-3)', padding: '4px 0' }, children: "No send-as addresses yet \u2014 add one below." })), addresses.length > 0 && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }, children: addresses.map(addr => (_jsxs("span", { style: {
                                fontSize: 10.5, padding: '2px 7px', borderRadius: 100,
                                background: 'var(--bg)', border: '1px solid var(--border)',
                                color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4,
                            }, children: [addr, _jsx("button", { onClick: () => removeAddress(addr), style: {
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--text-3)', fontSize: 11, padding: 0, lineHeight: 1,
                                        fontFamily: 'inherit',
                                    }, children: "\u00D7" })] }, addr))) })), _jsxs("div", { style: { display: 'flex', gap: 4, marginTop: 6 }, children: [_jsx("input", { type: "email", placeholder: "add address(es) \u2014 comma separated\u2026", value: newAddr, onChange: e => { setNewAddr(e.target.value); setAddrError(''); }, onKeyDown: e => e.key === 'Enter' && addAddress(), style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: addAddress, style: {
                                    padding: '5px 10px', fontSize: 11, fontWeight: 500,
                                    background: color, color: '#fff',
                                    border: 'none', borderRadius: 6, cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }, children: "Add" })] }), addrError && (_jsx("div", { style: { fontSize: 10.5, color: '#dc2626', marginTop: 4 }, children: addrError }))] }), _jsxs("div", { style: { marginBottom: 11 }, children: [_jsx("label", { style: { fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 5 }, children: "Color" }), _jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [COLORS.map(c => {
                                const selected = c === color;
                                return (_jsx("button", { onClick: () => saveColor(c), style: {
                                        width: 18, height: 18, borderRadius: '50%',
                                        background: c, border: 'none', cursor: 'pointer',
                                        outline: selected ? `2px solid ${c}` : 'none',
                                        outlineOffset: 1,
                                        transition: 'transform 0.12s',
                                        padding: 0,
                                    }, onMouseOver: e => (e.currentTarget.style.transform = 'scale(1.1)'), onMouseOut: e => (e.currentTarget.style.transform = 'scale(1)') }, c));
                            }), _jsxs("label", { style: { position: 'relative', cursor: 'pointer', display: 'inline-block' }, children: [_jsx("input", { type: "color", value: color, onChange: e => saveColor(e.target.value), style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' } }), _jsx("div", { style: {
                                            width: 18, height: 18, borderRadius: '50%',
                                            background: 'conic-gradient(#ff6b35, #f59e0b, #06d6a0, #3a86ff, #7b2fff, #e040a0, #ff6b35)',
                                            outline: !COLORS.includes(color) ? `2px solid ${color}` : 'none',
                                            outlineOffset: 1,
                                        } })] })] })] }), _jsx("button", { onClick: handleDelete, style: {
                    width: '100%', padding: 6, borderRadius: 6, cursor: 'pointer',
                    border: confirmDelete ? '1px solid #dc2626' : '1px solid var(--border)',
                    background: confirmDelete ? '#dc2626' : 'transparent',
                    color: confirmDelete ? '#fff' : 'var(--text-3)',
                    fontSize: 11, fontWeight: confirmDelete ? 600 : 500,
                    transition: 'all 0.15s', fontFamily: 'inherit',
                }, children: confirmDelete ? 'Click again to confirm deletion' : 'Delete this bowl' })] }));
}
const inputStyle = {
    width: '100%', padding: '6px 9px', fontSize: 12,
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg-card)', color: 'var(--text-1)', outline: 'none',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
};
function stripHtml(html) {
    // Quick-and-dirty: strip tags and decode common entities for forwarded body
    const text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text;
}
