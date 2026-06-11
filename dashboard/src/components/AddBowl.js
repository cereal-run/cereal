import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { PlusIcon } from './Icons';
import { testConnection, createBowl, createAccount } from '../onboarding-api';
import styles from './AddBowl.module.css';
const COLORS = [
    '#ff6b35', '#3a86ff', '#7b2fff', '#06d6a0',
    '#e040a0', '#f59e0b', '#ef4444', '#94a3b8',
];
const PROVIDERS = [
    { id: 'google_workspace', name: 'Gmail / Workspace', icon: '✉️', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, helpText: 'Requires an App Password — not your regular password.', helpUrl: 'https://myaccount.google.com/apppasswords' },
    { id: 'imap_fastmail', name: 'Fastmail', icon: '⚡', imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 587, helpText: 'Requires an App Password from Settings → Privacy & Security.', helpUrl: 'https://app.fastmail.com/settings/security' },
    { id: 'imap_privateemail', name: 'Namecheap PrivateEmail', icon: '🔒', imapHost: 'mail.privateemail.com', imapPort: 993, smtpHost: 'mail.privateemail.com', smtpPort: 587, helpText: 'Use your full email + mailbox password. SMTP is STARTTLS on port 587.', helpUrl: 'https://www.privateemail.com/support/' },
    { id: 'imap_icloud', name: 'iCloud / iCloud+', icon: '☁️', imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, helpText: 'Requires an app-specific password from appleid.apple.com → Sign-In & Security.', helpUrl: 'https://appleid.apple.com/account/manage' },
    { id: 'imap_zoho', name: 'Zoho Mail', icon: '🇿', imapHost: 'imap.zoho.com', imapPort: 993, smtpHost: 'smtp.zoho.com', smtpPort: 465, helpText: 'Enable IMAP access in Settings → Mail Accounts → IMAP. If 2FA is on, generate an app password.', helpUrl: 'https://accounts.zoho.com/home#security/app_password' },
    { id: 'imap_migadu', name: 'Migadu', icon: '✦', imapHost: 'imap.migadu.com', imapPort: 993, smtpHost: 'smtp.migadu.com', smtpPort: 465, helpText: 'Use your full email + mailbox password.', helpUrl: 'https://www.migadu.com/guides/imap/' },
    { id: 'outlook', name: 'Outlook / M365', icon: '📧', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, helpText: 'If 2FA is on, use an App Password from account.microsoft.com → Security.', helpUrl: 'https://account.microsoft.com/security' },
    { id: 'imap', name: 'Other / Custom', icon: '🔧', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, helpText: 'Enter your IMAP and SMTP server details manually.', helpUrl: '' },
];
export function AddBowl({ onAdd, onComplete }) {
    const [step, setStep] = useState('closed');
    const [name, setName] = useState('');
    const [color, setColor] = useState(COLORS[0]);
    const [provider, setProvider] = useState(PROVIDERS[0]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [addresses, setAddresses] = useState([]);
    const [addressInput, setAddressInput] = useState('');
    const [imapHost, setImapHost] = useState('');
    const [imapPort, setImapPort] = useState(993);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState(587);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [error, setError] = useState('');
    const [connecting, setConnecting] = useState(false);
    function reset() {
        setStep('closed');
        setName('');
        setColor(COLORS[0]);
        setEmail('');
        setPassword('');
        setAddresses([]);
        setAddressInput('');
        setError('');
        setConnecting(false);
        setShowAdvanced(false);
        setProvider(PROVIDERS[0]);
    }
    function selectProvider(p) {
        setProvider(p);
        setImapHost(p.imapHost);
        setImapPort(p.imapPort);
        setSmtpHost(p.smtpHost);
        setSmtpPort(p.smtpPort);
        setShowAdvanced(p.id === 'imap');
        setError('');
        setStep('credentials');
    }
    function addAddress() {
        const addr = addressInput.trim().toLowerCase();
        if (!addr || !addr.includes('@'))
            return;
        if (!addresses.includes(addr))
            setAddresses(prev => [...prev, addr]);
        setAddressInput('');
    }
    async function handleConnect() {
        if (!email.trim() || !password.trim()) {
            setError('Email and password are required.');
            return;
        }
        setConnecting(true);
        setError('');
        const test = await testConnection({
            provider: provider.id,
            username: email.trim(),
            password,
            imapHost: imapHost || undefined,
            imapPort: imapPort || undefined,
        });
        if (!test.ok) {
            setError(test.error ?? 'Connection failed.');
            setConnecting(false);
            return;
        }
        // The bowl claims the addresses the user entered. The login email is a
        // credential, not necessarily a business address (Fastmail/Workspace
        // users sign in with one address but want others in the bowl). Fall back
        // to the login address only when nothing else was entered.
        const entered = addresses.map(a => a.trim().toLowerCase()).filter(Boolean);
        const bowlAddresses = entered.length > 0 ? entered : [email.trim().toLowerCase()];
        try {
            setStep('saving');
            // Connect the mailbox (standalone — no bowl link) and create the bowl
            // that claims these addresses. Order doesn't strictly matter since
            // they're decoupled, but connecting first means that if the mailbox
            // connection fails we don't leave an orphan bowl behind.
            await createAccount({
                label: name.trim(),
                provider: provider.id,
                username: email.trim(),
                password,
                defaultFrom: email.trim(),
                imapHost: imapHost || undefined,
                imapPort: imapPort || undefined,
                smtpHost: smtpHost || undefined,
                smtpPort: smtpPort || undefined,
            });
            await createBowl(name.trim(), color, bowlAddresses[0], bowlAddresses);
            onAdd(name.trim(), color);
            reset();
            onComplete?.();
        }
        catch (err) {
            setError(err.message || 'Failed to save.');
            setStep('credentials');
        }
        setConnecting(false);
    }
    // ── Closed tile ──────────────────────────────────────────────────────────────
    if (step === 'closed') {
        return (_jsxs("div", { className: styles.tile, onClick: () => setStep('name'), children: [_jsx(PlusIcon, { size: 16, color: "var(--text-3)" }), _jsx("span", { className: styles.label, children: "New bowl" })] }));
    }
    // ── Saving ───────────────────────────────────────────────────────────────────
    if (step === 'saving') {
        return (_jsx("div", { className: `${styles.form} ${styles.expanded}`, style: { borderColor: color }, children: _jsx("div", { className: styles.formHeader, style: { justifyContent: 'center', padding: '1.5rem' }, children: _jsxs("span", { style: { fontSize: '0.85rem', color: 'var(--text-2)' }, children: ["Setting up ", name, "\u2026"] }) }) }));
    }
    return (_jsxs("div", { className: `${styles.form} ${styles.expanded}`, style: { borderColor: color }, children: [step === 'name' && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.formHeader, children: _jsx("input", { className: styles.nameInput, value: name, onChange: e => setName(e.target.value), placeholder: "Business name\u2026", autoFocus: true, onKeyDown: e => e.key === 'Enter' && name.trim() && setStep('provider'), style: { caretColor: color } }) }), _jsxs("div", { className: styles.colorRow, children: [COLORS.map(c => (_jsx("button", { className: `${styles.swatch} ${c === color ? styles.selected : ''}`, style: { background: c, outlineColor: c }, onClick: () => setColor(c) }, c))), _jsxs("label", { className: `${styles.customSwatch} ${!COLORS.includes(color) ? styles.customSwatchActive : ''}`, style: !COLORS.includes(color) ? { background: color, color: '#fff', outlineColor: color } : undefined, title: "Custom color", children: [COLORS.includes(color) && '+', _jsx("input", { type: "color", value: color, onChange: e => setColor(e.target.value) })] })] }), _jsxs("div", { className: styles.formActions, children: [_jsx("button", { className: styles.addBtn, style: { background: color }, onClick: () => setStep('provider'), disabled: !name.trim(), children: "Continue \u2192" }), _jsx("button", { className: styles.cancelBtn, onClick: reset, children: "Cancel" })] })] })), step === 'provider' && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.formHeader, children: _jsxs("span", { style: { fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-2)' }, children: [name, " \u2014 connect email"] }) }), _jsx("div", { className: styles.providerGrid, children: PROVIDERS.map(p => (_jsxs("button", { className: styles.providerTile, onClick: () => selectProvider(p), children: [_jsx("span", { className: styles.providerIcon, children: p.icon }), _jsx("span", { className: styles.providerName, children: p.name })] }, p.id))) }), _jsx("div", { className: styles.formActions, children: _jsx("button", { className: styles.cancelBtn, onClick: () => setStep('name'), children: "\u2190 Back" }) })] })), step === 'credentials' && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.formHeader, children: _jsxs("span", { style: { fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-2)' }, children: [name, " \u00B7 ", provider.icon, " ", provider.name] }) }), error && _jsx("div", { className: styles.credError, children: error }), _jsxs("div", { className: styles.credFields, children: [_jsx("input", { className: styles.credInput, type: "email", placeholder: "Email address", value: email, onChange: e => setEmail(e.target.value), autoFocus: true }), _jsxs("div", { children: [_jsx("input", { className: styles.credInput, type: "password", placeholder: "App password", value: password, onChange: e => setPassword(e.target.value), onKeyDown: e => e.key === 'Enter' && handleConnect() }), provider.helpText && (_jsxs("div", { className: styles.credHelp, children: [provider.helpText, provider.helpUrl && _jsxs(_Fragment, { children: [" ", _jsx("a", { href: provider.helpUrl, target: "_blank", rel: "noreferrer", children: "Generate \u2192" })] })] }))] }), _jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', gap: '5px' }, children: [_jsx("input", { className: styles.credInput, type: "email", placeholder: "Add another address (optional)", value: addressInput, onChange: e => setAddressInput(e.target.value), onKeyDown: e => e.key === 'Enter' && (addAddress(), e.preventDefault()), style: { flex: 1 } }), _jsx("button", { onClick: addAddress, className: styles.addAddrBtn, children: "Add" })] }), addresses.length > 0 && (_jsx("div", { className: styles.addrChips, children: addresses.map(a => (_jsxs("span", { className: styles.addrChip, children: [a, _jsx("button", { onClick: () => setAddresses(prev => prev.filter(x => x !== a)), className: styles.addrRemove, children: "\u00D7" })] }, a))) }))] }), showAdvanced && (_jsxs("div", { className: styles.advancedGrid, children: [_jsx("input", { className: styles.credInput, placeholder: "IMAP host", value: imapHost, onChange: e => setImapHost(e.target.value) }), _jsx("input", { className: styles.credInput, placeholder: "Port", type: "number", value: imapPort, onChange: e => setImapPort(Number(e.target.value)), style: { width: 70 } }), _jsx("input", { className: styles.credInput, placeholder: "SMTP host", value: smtpHost, onChange: e => setSmtpHost(e.target.value) }), _jsx("input", { className: styles.credInput, placeholder: "Port", type: "number", value: smtpPort, onChange: e => setSmtpPort(Number(e.target.value)), style: { width: 70 } })] })), provider.id !== 'imap' && (_jsxs("button", { className: styles.advancedToggle, onClick: () => setShowAdvanced(v => !v), children: [showAdvanced ? '▾ Hide' : '▸ Show', " advanced IMAP settings"] }))] }), _jsxs("div", { className: styles.formActions, children: [_jsx("button", { className: styles.addBtn, style: { background: color }, onClick: handleConnect, disabled: connecting, children: connecting ? 'Connecting…' : 'Connect →' }), _jsx("button", { className: styles.cancelBtn, onClick: () => { setStep('provider'); setError(''); }, children: "\u2190 Back" })] })] }))] }));
}
