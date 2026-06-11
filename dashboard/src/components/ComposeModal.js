import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { getComposeContext, sendEmail } from '../api';
import { CloseIcon } from './Icons';
import styles from './ComposeModal.module.css';
export function ComposeModal({ bowl, replyTo, forward, onClose, onSent }) {
    const [context, setContext] = useState(null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState(replyTo?.fromEmail ?? '');
    const [subject, setSubject] = useState(() => {
        if (replyTo?.subject) {
            return replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`;
        }
        if (forward?.subject) {
            return forward.subject.startsWith('Fwd:') ? forward.subject : `Fwd: ${forward.subject}`;
        }
        return '';
    });
    const [body, setBody] = useState(() => {
        if (forward) {
            const sender = forward.fromName ? `${forward.fromName} <${forward.fromEmail}>` : forward.fromEmail;
            const dateStr = new Date(forward.date).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true,
            });
            return `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${dateStr}\nSubject: ${forward.subject ?? '(no subject)'}\n\n${forward.body}`;
        }
        return '';
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        getComposeContext(bowl.id).then(ctx => {
            setContext(ctx);
            setFrom(ctx.suggestedFrom);
        }).catch(() => { });
    }, [bowl.id]);
    async function handleSend() {
        if (!to.trim() || !subject.trim() || !body.trim()) {
            setError('To, subject, and body are required.');
            return;
        }
        if (!context?.accounts.length) {
            setError('No account found for this bowl.');
            return;
        }
        // Find the account whose default or aliases include the selected From address
        const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;
        const account = context.accounts.find(a => {
            const accountEmail = a.defaultFrom.match(/<([^>]+)>/)?.[1] ?? a.defaultFrom;
            const aliasEmails = a.aliases.map(al => al.match(/<([^>]+)>/)?.[1] ?? al);
            return accountEmail === fromEmail || aliasEmails.includes(fromEmail);
        }) ?? context.accounts[0];
        setSending(true);
        setError('');
        try {
            await sendEmail({
                accountId: account.id,
                from: from,
                to: [{ name: null, email: to.trim() }],
                subject,
                textPlain: body,
                ...(replyTo?.messageId ? { inReplyTo: replyTo.messageId } : {}),
            });
            onSent();
            onClose();
        }
        catch (err) {
            setError(err.message || 'Failed to send.');
        }
        finally {
            setSending(false);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.overlay, onClick: onClose }), _jsxs("div", { className: styles.modal, style: { borderTopColor: bowl.color }, children: [_jsxs("div", { className: styles.header, children: [_jsxs("div", { className: styles.title, children: [_jsx("span", { className: styles.bowlDot, style: { background: bowl.color } }), forward ? 'Forward' : replyTo ? 'Reply' : 'New message', " \u00B7 ", bowl.name] }), _jsx("button", { className: styles.closeBtn, onClick: onClose, children: _jsx(CloseIcon, { size: 11 }) })] }), _jsxs("div", { className: styles.field, children: [_jsx("label", { className: styles.label, children: "From" }), context ? (_jsx("select", { className: styles.select, value: from, onChange: e => setFrom(e.target.value), children: context.availableFrom.map(f => (_jsx("option", { value: f, children: f }, f))) })) : (_jsx("span", { className: styles.loadingText, children: "Loading\u2026" }))] }), _jsxs("div", { className: styles.field, children: [_jsx("label", { className: styles.label, children: "To" }), _jsx("input", { className: styles.input, type: "email", value: to, onChange: e => setTo(e.target.value), placeholder: "recipient@example.com", autoFocus: !replyTo })] }), _jsxs("div", { className: styles.field, children: [_jsx("label", { className: styles.label, children: "Subject" }), _jsx("input", { className: styles.input, type: "text", value: subject, onChange: e => setSubject(e.target.value), placeholder: "Subject" })] }), _jsx("textarea", { className: styles.body, value: body, onChange: e => setBody(e.target.value), placeholder: "Write your message\u2026", autoFocus: !!replyTo }), error && _jsx("div", { className: styles.error, children: error }), _jsxs("div", { className: styles.footer, children: [_jsx("button", { className: styles.sendBtn, style: { background: bowl.color }, onClick: handleSend, disabled: sending, children: sending ? 'Sending…' : 'Send' }), _jsx("button", { className: styles.cancelBtn, onClick: onClose, children: "Cancel" })] })] })] }));
}
