import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { login, signup, forgotPassword, resetPassword } from '../api';
import styles from './Login.module.css';
/**
 * Read the reset token from the URL once at module evaluation. The reset
 * email links to `/?reset_token=...` — if it's present, the Login screen
 * opens directly in reset mode. The token is stripped from the address bar
 * immediately so it doesn't linger in the visible URL or get copied along
 * when the user shares their screen or the page.
 */
function consumeResetTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (token) {
        params.delete('reset_token');
        const rest = params.toString();
        const clean = window.location.pathname + (rest ? `?${rest}` : '');
        window.history.replaceState({}, '', clean);
    }
    return token;
}
const initialResetToken = consumeResetTokenFromUrl();
export function Login({ onSuccess }) {
    const [mode, setMode] = useState(initialResetToken ? 'reset' : 'login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    function switchMode(next) {
        setMode(next);
        setError('');
        setNotice('');
    }
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setNotice('');
        setLoading(true);
        try {
            if (mode === 'login') {
                await login(email, password);
                onSuccess();
            }
            else if (mode === 'signup') {
                await signup(email, password, inviteCode || undefined);
                onSuccess();
            }
            else if (mode === 'forgot') {
                await forgotPassword(email);
                setNotice('If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.');
                setLoading(false);
            }
            else if (mode === 'reset') {
                if (!initialResetToken) {
                    throw new Error('This reset link is invalid. Request a new one.');
                }
                await resetPassword(initialResetToken, password);
                setPassword('');
                setMode('login');
                setNotice('Password updated. Sign in with your new password.');
                setLoading(false);
            }
        }
        catch (err) {
            setError(err.message || 'Something went wrong');
            setLoading(false);
        }
    }
    const title = mode === 'login' ? 'Welcome back'
        : mode === 'signup' ? 'Create your account'
            : mode === 'forgot' ? 'Reset your password'
                : 'Choose a new password';
    const subtitle = mode === 'login' ? 'Sign in to your bowls'
        : mode === 'signup' ? 'Every business in its own bowl'
            : mode === 'forgot' ? "Enter your email and we'll send a reset link"
                : 'At least 12 characters';
    const submitLabel = loading
        ? (mode === 'login' ? 'Signing in…'
            : mode === 'signup' ? 'Creating account…'
                : mode === 'forgot' ? 'Sending…'
                    : 'Updating…')
        : (mode === 'login' ? 'Sign in'
            : mode === 'signup' ? 'Create account'
                : mode === 'forgot' ? 'Send reset link'
                    : 'Set new password');
    return (_jsx("div", { className: styles.overlay, children: _jsxs("div", { className: styles.card, children: [_jsxs("div", { className: styles.logo, children: [_jsx("svg", { className: styles.logoMark, viewBox: "0 0 32 32", "aria-hidden": "true", xmlns: "http://www.w3.org/2000/svg", children: _jsxs("g", { fill: "none", strokeWidth: "3.5", children: [_jsx("circle", { cx: "9", cy: "9", r: "4.5", stroke: "#ff6b35" }), _jsx("circle", { cx: "23", cy: "9", r: "4.5", stroke: "#f72585" }), _jsx("circle", { cx: "9", cy: "23", r: "4.5", stroke: "#7b2fff" }), _jsx("circle", { cx: "23", cy: "23", r: "4.5", stroke: "#3a86ff" })] }) }), "Cereal"] }), _jsx("h1", { className: styles.title, children: title }), _jsx("p", { className: styles.subtitle, children: subtitle }), _jsxs("form", { onSubmit: handleSubmit, className: styles.form, children: [error && _jsx("div", { className: styles.error, children: error }), notice && (_jsx("div", { style: {
                                padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.8rem',
                                background: 'rgba(6,214,160,0.1)', color: '#06d6a0',
                                border: '1px solid rgba(6,214,160,0.25)', lineHeight: 1.45,
                            }, children: notice })), mode !== 'reset' && (_jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.label, children: "Email" }), _jsx("input", { type: "email", autoComplete: "email", required: true, value: email, onChange: e => setEmail(e.target.value), className: styles.input, autoFocus: true })] })), mode !== 'forgot' && (_jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.label, children: mode === 'reset' ? 'New password' : 'Password' }), _jsx("input", { type: "password", autoComplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: mode === 'signup' || mode === 'reset' ? 12 : undefined, value: password, onChange: e => setPassword(e.target.value), className: styles.input, autoFocus: mode === 'reset' }), (mode === 'signup' || mode === 'reset') && (_jsx("span", { className: styles.hint, children: "At least 12 characters" }))] })), mode === 'signup' && (_jsxs("label", { className: styles.field, children: [_jsxs("span", { className: styles.label, children: ["Invite code ", _jsx("span", { style: { color: 'var(--text-3)', fontWeight: 400 }, children: "(optional)" })] }), _jsx("input", { type: "text", value: inviteCode, onChange: e => setInviteCode(e.target.value), className: styles.input, placeholder: "If you have one" }), _jsx("span", { className: styles.hint, children: "Required only during early access lockdown." })] })), _jsx("button", { type: "submit", disabled: loading, className: styles.submit, children: submitLabel })] }), _jsxs("div", { className: styles.switcher, children: [mode === 'login' && (_jsxs(_Fragment, { children: ["No account yet?", ' ', _jsx("button", { type: "button", onClick: () => switchMode('signup'), className: styles.linkButton, children: "Create one" }), _jsx("span", { style: { margin: '0 0.4rem', color: 'var(--text-3)' }, children: "\u00B7" }), _jsx("button", { type: "button", onClick: () => switchMode('forgot'), className: styles.linkButton, children: "Forgot password?" })] })), mode === 'signup' && (_jsxs(_Fragment, { children: ["Already have an account?", ' ', _jsx("button", { type: "button", onClick: () => switchMode('login'), className: styles.linkButton, children: "Sign in" })] })), (mode === 'forgot' || mode === 'reset') && (_jsx("button", { type: "button", onClick: () => switchMode('login'), className: styles.linkButton, children: "Back to sign in" }))] })] }) }));
}
