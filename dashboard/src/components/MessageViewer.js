import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from 'react';
import { getMessageBody, markSeen, markUnseen } from '../api';
import { CloseIcon, ArrowRightIcon } from './Icons';
import styles from './MessageViewer.module.css';
/**
 * Wrap untrusted email HTML in a document with a strict Content-Security-Policy.
 *
 * Defense layers (both must fail for script execution):
 *   1. The iframe sandbox attribute blocks scripts and same-origin access.
 *      We deliberately do NOT set allow-same-origin — with srcDoc that would
 *      make the frame same-origin with the dashboard, and any future
 *      addition of allow-scripts would hand email content full access to
 *      localStorage (session token) and the API.
 *   2. The CSP meta tag inside the document blocks script-src entirely
 *      (default-src 'none'), so even if the sandbox were misconfigured,
 *      inline handlers, <script> tags, and javascript: URLs are dead.
 *
 * Remote images and inline styles are allowed — emails are unusable without
 * them. <base target="_blank"> makes links open in a new tab, which the
 * sandbox permits via allow-popups; allow-popups-to-escape-sandbox ensures
 * the opened tab behaves like a normal page instead of inheriting the
 * sandbox restrictions.
 */
function wrapEmailHtml(html) {
    return [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<meta http-equiv="Content-Security-Policy" content="',
        "default-src 'none'; ",
        "img-src https: http: data: cid:; ",
        "style-src 'unsafe-inline' https:; ",
        "font-src https: data:",
        '">',
        '<base target="_blank">',
        '<style>',
        'body{margin:0;padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:14px;line-height:1.5;color:#1a1a1a;background:#ffffff;word-wrap:break-word;overflow-wrap:break-word}',
        'img{max-width:100%;height:auto}',
        'table{max-width:100%}',
        '</style>',
        '</head><body>',
        html,
        '</body></html>',
    ].join('');
}
export function MessageViewer({ message, accentColor, onClose, onReply, onForward, onStatusChange }) {
    const [body, setBody] = useState(null);
    const [loading, setLoading] = useState(true);
    const [seen, setSeenLocal] = useState(message.seen);
    const wrappedHtml = useMemo(() => (body?.textHtml ? wrapEmailHtml(body.textHtml) : null), [body]);
    const fromLabel = message.fromName && message.fromEmail
        ? `${message.fromName} <${message.fromEmail}>`
        : message.fromEmail || 'Unknown sender';
    useEffect(() => {
        setLoading(true);
        setSeenLocal(message.seen);
        getMessageBody(message.accountId, message.uid)
            .then(b => { setBody(b); setLoading(false); })
            .catch(() => setLoading(false));
        // Auto-mark as seen on open
        if (!message.seen) {
            markSeen(message.accountId, [message.uid]).catch(() => { });
            setSeenLocal(true);
        }
    }, [message.id, message.accountId, message.uid, message.seen]);
    async function toggleSeen() {
        const folder = message.isSent ? 'Sent' : 'INBOX';
        if (seen) {
            await markUnseen(message.accountId, [message.uid], folder).catch(() => { });
            setSeenLocal(false);
        }
        else {
            await markSeen(message.accountId, [message.uid], folder).catch(() => { });
            setSeenLocal(true);
        }
        onStatusChange?.();
    }
    const date = new Date(message.date).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.overlay, onClick: onClose }), _jsxs("div", { className: styles.panel, style: { borderTopColor: accentColor }, children: [_jsxs("div", { className: styles.header, children: [_jsxs("div", { className: styles.headerLeft, children: [_jsx("button", { className: styles.closeBtn, onClick: onClose, children: _jsx(CloseIcon, { size: 11 }) }), message.isSent && (_jsx("span", { style: {
                                            fontSize: '0.62rem', padding: '2px 7px', borderRadius: 4,
                                            background: 'rgba(6,214,160,0.12)', color: '#06d6a0',
                                            fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                                        }, children: "\u2197 Sent" }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' }, children: [_jsx("button", { onClick: toggleSeen, title: seen ? 'Mark as unread' : 'Mark as read', style: {
                                            border: '1px solid var(--border)', background: 'transparent',
                                            color: 'var(--text-3)', fontSize: '0.68rem', padding: '0.3rem 0.7rem',
                                            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                                        }, children: seen ? '○ Unread' : '● Read' }), !message.isSent && (_jsxs(_Fragment, { children: [onForward && body && (body.textHtml || body.textPlain) && (_jsx("button", { onClick: () => onForward(body), style: {
                                                    border: '1px solid var(--border)', background: 'transparent',
                                                    color: 'var(--text-2)', fontSize: '0.7rem', padding: '0.35rem 0.7rem',
                                                    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                                                }, children: "Forward \u2192" })), _jsxs("button", { className: styles.replyBtn, style: { borderColor: accentColor, color: accentColor }, onClick: () => onReply(), children: ["Reply ", _jsx(ArrowRightIcon, { size: 10, color: accentColor })] })] }))] })] }), _jsxs("div", { className: styles.meta, children: [_jsx("div", { className: styles.subject, children: message.subject || '(no subject)' }), _jsx("div", { className: styles.fromLine, children: message.isSent ? 'From you' : fromLabel }), _jsx("div", { className: styles.dateLine, children: date }), message.toAddrs.filter(a => a.email && !a.email.includes('undefined')).length > 0 && (_jsxs("div", { className: styles.toLine, children: ["To: ", message.toAddrs.filter(a => a.email && !a.email.includes('undefined')).map(a => a.name || a.email).join(', ')] }))] }), _jsxs("div", { className: styles.body, children: [loading && _jsx("div", { className: styles.loading, children: "Loading\u2026" }), !loading && wrappedHtml && (_jsx("iframe", { className: styles.iframe, srcDoc: wrappedHtml, 
                                // No allow-scripts, no allow-same-origin. allow-popups lets
                                // links (forced to target="_blank" by the <base> tag in the
                                // wrapper) open in a new tab; allow-popups-to-escape-sandbox
                                // makes that tab a normal page rather than a sandboxed one.
                                sandbox: "allow-popups allow-popups-to-escape-sandbox", referrerPolicy: "no-referrer", title: "Email body" })), !loading && !body?.textHtml && body?.textPlain && (_jsx("pre", { className: styles.plain, children: body.textPlain })), !loading && !body?.textHtml && !body?.textPlain && (_jsx("div", { className: styles.empty, children: "No content to display." }))] })] })] }));
}
