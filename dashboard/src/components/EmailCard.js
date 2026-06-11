import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AttachmentIcon } from './Icons';
import { Avatar } from './Avatar';
import styles from './EmailCard.module.css';
export function EmailCard({ message, accentColor, onClick, isSpam }) {
    const recipient = message.toAddrs?.[0];
    const displayName = message.isSent
        ? (recipient?.name || recipient?.email?.split('@')[0] || 'someone')
        : (message.fromName || message.fromEmail.split('@')[0]);
    const displayEmail = message.isSent ? (recipient?.email ?? '') : message.fromEmail;
    const time = formatTime(message.date);
    return (_jsxs("div", { className: `${styles.card} ${message.seen ? styles.read : styles.unread} ${isSpam ? styles.spam : ''}`, style: { ['--accent']: accentColor }, onClick: onClick, role: "button", tabIndex: 0, onKeyDown: e => e.key === 'Enter' && onClick(), children: [_jsx(Avatar, { name: displayName, email: displayEmail, accentColor: accentColor }), _jsxs("div", { className: styles.content, children: [_jsxs("div", { className: styles.top, children: [_jsxs("span", { className: styles.from, children: [message.isSent && (_jsx("span", { style: { color: 'var(--text-3)', fontWeight: 400, marginRight: 4 }, children: "\u2197 To" })), displayName] }), _jsxs("div", { className: styles.meta, children: [message.hasAttachments && _jsx(AttachmentIcon, { size: 9, color: "var(--text-3)" }), _jsx("span", { className: styles.time, children: time })] })] }), _jsx("div", { className: styles.subject, children: message.subject || '(no subject)' })] })] }));
}
function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000)
        return 'just now';
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)}m`;
    const isToday = d.toDateString() === now.toDateString();
    if (isToday)
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString())
        return 'Yesterday';
    if (diff < 6 * 86_400_000) {
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
