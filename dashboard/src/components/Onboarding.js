import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { testConnection, createBowl, createAccount, getOAuthAuthUrl, getOAuthProviders } from '../onboarding-api';
import styles from './Onboarding.module.css';
const BOWL_COLORS = [
    '#ff6b35', '#3a86ff', '#7b2fff',
    '#06d6a0', '#e040a0', '#f59e0b',
];
const PROVIDERS = [
    {
        id: 'google_workspace',
        name: 'Gmail / Workspace',
        icon: '✉️',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        helpText: 'Requires an App Password, not your regular password.',
        helpUrl: 'https://myaccount.google.com/apppasswords',
    },
    {
        id: 'imap_fastmail',
        name: 'Fastmail',
        icon: '⚡',
        imapHost: 'imap.fastmail.com',
        imapPort: 993,
        smtpHost: 'smtp.fastmail.com',
        smtpPort: 587,
        helpText: 'Requires an App Password from Settings → Privacy & Security.',
        helpUrl: 'https://app.fastmail.com/settings/security',
    },
    {
        id: 'imap_privateemail',
        name: 'Namecheap PrivateEmail',
        icon: '🔒',
        imapHost: 'mail.privateemail.com',
        imapPort: 993,
        smtpHost: 'mail.privateemail.com',
        smtpPort: 587,
        helpText: 'Use your full email + mailbox password. SMTP is STARTTLS on port 587.',
        helpUrl: 'https://www.privateemail.com/support/',
    },
    {
        id: 'imap_icloud',
        name: 'iCloud / iCloud+',
        icon: '☁️',
        imapHost: 'imap.mail.me.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.me.com',
        smtpPort: 587,
        helpText: 'Requires an app-specific password from appleid.apple.com → Sign-In & Security.',
        helpUrl: 'https://appleid.apple.com/account/manage',
    },
    {
        id: 'imap_zoho',
        name: 'Zoho Mail',
        icon: '🇿',
        imapHost: 'imap.zoho.com',
        imapPort: 993,
        smtpHost: 'smtp.zoho.com',
        smtpPort: 465,
        helpText: 'Enable IMAP access in Settings → Mail Accounts → IMAP. If 2FA is on, generate an app password.',
        helpUrl: 'https://accounts.zoho.com/home#security/app_password',
    },
    {
        id: 'imap_migadu',
        name: 'Migadu',
        icon: '✦',
        imapHost: 'imap.migadu.com',
        imapPort: 993,
        smtpHost: 'smtp.migadu.com',
        smtpPort: 465,
        helpText: 'Use your full email + mailbox password.',
        helpUrl: 'https://www.migadu.com/guides/imap/',
    },
    {
        id: 'outlook',
        name: 'Outlook / M365',
        icon: '📧',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        helpText: 'If 2FA is on, use an App Password from account.microsoft.com → Security.',
        helpUrl: 'https://account.microsoft.com/security',
    },
    {
        id: 'imap',
        name: 'Other / Custom',
        icon: '🔧',
        imapHost: '',
        imapPort: 993,
        smtpHost: '',
        smtpPort: 587,
        helpText: 'Enter your IMAP and SMTP server details manually.',
        helpUrl: '',
    },
];
function formatOAuthError(err, detail) {
    switch (err) {
        case 'access_denied':
            return 'You denied access. Try again if you want to connect this account.';
        case 'no_refresh_token':
            return "Google didn't return a refresh token. Try again, and if it keeps happening, revoke Cereal at myaccount.google.com/permissions and retry.";
        case 'invalid_state':
            return 'OAuth session expired. Try again.';
        case 'no_email':
            return "Couldn't read your email address from the provider response. Try again.";
        case 'exchange_failed':
            return `OAuth token exchange failed${detail ? `: ${detail}` : '.'}`;
        case 'not_configured':
            return 'OAuth is not configured on this server. Contact the operator.';
        default:
            return `OAuth failed: ${err}${detail ? ` (${detail})` : ''}`;
    }
}
const OAUTH_PROVIDERS = [
    {
        id: 'google',
        name: 'Continue with Google',
        iconBg: '#fff',
        description: 'Gmail or Google Workspace. No password needed',
    },
    {
        id: 'microsoft',
        name: 'Continue with Microsoft',
        iconBg: '#fff',
        description: 'Outlook.com or Microsoft 365. No password needed',
    },
];
export function Onboarding({ onComplete }) {
    // Split a free-form input into one or more email-shaped tokens.
    // Splits on commas, semicolons, newlines, or whitespace — same delimiters
    // exports from Google Contacts, Outlook, etc. tend to use. Returns
    // lowercased, deduplicated, non-empty tokens (no email validation here —
    // we do that downstream if it matters).
    function tokenizeAddresses(input) {
        return [...new Set(input.split(/[,;\n\s]+/)
                .map(t => t.trim().toLowerCase())
                .filter(Boolean))];
    }
    const [step, setStep] = useState('welcome');
    const [provider, setProvider] = useState(null);
    const [oauthProvider, setOauthProvider] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [bowlName, setBowlName] = useState('');
    const [bowlColor, setBowlColor] = useState(BOWL_COLORS[0]);
    const [addresses, setAddresses] = useState([]);
    const [addressInput, setAddressInput] = useState('');
    const [imapHost, setImapHost] = useState('');
    const [imapPort, setImapPort] = useState(993);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState(587);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Which OAuth providers the backend has env vars configured for. Empty until
    // we hear back — better to show no buttons briefly than to show buttons that
    // will error out when clicked.
    const [availableOAuth, setAvailableOAuth] = useState(new Set());
    // ── Discover which OAuth providers are wired up on the backend ──────────
    useEffect(() => {
        getOAuthProviders().then(p => {
            const s = new Set();
            if (p.google)
                s.add('google');
            if (p.microsoft)
                s.add('microsoft');
            setAvailableOAuth(s);
        }).catch(() => {
            // If the check fails (e.g. backend down), don't show buttons that would
            // fail anyway — fall back to IMAP-only.
            setAvailableOAuth(new Set());
        });
    }, []);
    // ── Handle return from OAuth ─────────────────────────────────────────────
    // After the user authorizes at Google/Microsoft, the backend redirects them
    // here with ?oauth_success=1&account=email or ?oauth_error=...
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('oauth_success') === '1') {
            const account = params.get('account');
            if (account)
                setEmail(account);
            setStep('success');
            // Clean the URL so a refresh doesn't re-trigger
            window.history.replaceState({}, '', window.location.pathname);
        }
        else if (params.has('oauth_error')) {
            const err = params.get('oauth_error') || 'unknown';
            const detail = params.get('oauth_error_description') || params.get('detail');
            setError(formatOAuthError(err, detail));
            setStep('provider');
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);
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
    function selectOAuthProvider(p) {
        setOauthProvider(p);
        setError('');
        setStep('oauth_bowl');
    }
    async function handleOAuthContinue() {
        if (!oauthProvider)
            return;
        setLoading(true);
        setError('');
        const name = bowlName.trim() || (oauthProvider.id === 'google' ? 'Gmail' : 'Outlook');
        // Bowl claims only the addresses the user explicitly entered. With OAuth
        // there's no typed login address to fall back to (the account identity
        // comes from the provider after auth), so if they entered nothing we
        // create the bowl with an empty claim — they'll add addresses after,
        // and can edit the bowl once their mailbox is connected.
        const bowlAddresses = addresses
            .map(a => a.trim().toLowerCase())
            .filter(Boolean);
        // Create the first bowl now so there's somewhere for mail to land after
        // the OAuth mailbox connects. The bowl is independent of the account —
        // it just claims these addresses. The OAuth callback connects the
        // mailbox (no bowl link); routing matches incoming mail to this bowl by
        // address.
        try {
            if (bowlAddresses.length > 0) {
                await createBowl(name, bowlColor, bowlAddresses[0], bowlAddresses);
            }
        }
        catch (err) {
            setError(err.message || 'Failed to create bowl.');
            setLoading(false);
            return;
        }
        try {
            // No bowlId — connecting a mailbox is standalone now.
            const { authUrl } = await getOAuthAuthUrl(oauthProvider.id);
            window.location.href = authUrl;
        }
        catch (err) {
            setError(err.message || 'Failed to start OAuth flow.');
            setLoading(false);
        }
    }
    function deriveDefaultBowlName(emailAddr) {
        const domain = emailAddr.split('@')[1] ?? '';
        const name = domain.split('.')[0] ?? '';
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    async function handleConnect() {
        if (!provider || !email.trim() || !password.trim()) {
            setError('Please enter your email and password.');
            return;
        }
        setLoading(true);
        setError('');
        // Step 1: test connection
        const test = await testConnection({
            provider: provider.id,
            username: email.trim(),
            password,
            imapHost: imapHost || undefined,
            imapPort: imapPort || undefined,
        });
        if (!test.ok) {
            setError(test.error ?? 'Connection failed. Check your credentials and try again.');
            setLoading(false);
            return;
        }
        const name = bowlName.trim() || deriveDefaultBowlName(email);
        // The bowl claims the addresses the user explicitly entered. The login
        // email (`email`) is an AUTH credential, not necessarily a business
        // address — for Fastmail/Workspace users it's just how they sign in, and
        // forcing it into the bowl would pull unrelated mail. Only fall back to
        // the login address when the user entered no addresses at all (the simple
        // case where their login *is* their business email).
        const entered = addresses
            .map(a => a.trim().toLowerCase())
            .filter(Boolean);
        const bowlAddresses = entered.length > 0 ? entered : [email.trim().toLowerCase()];
        // Step 2: connect the mailbox (standalone — not tied to any bowl).
        try {
            await createAccount({
                label: name,
                provider: provider.id,
                username: email.trim(),
                password,
                defaultFrom: email.trim(),
                imapHost: imapHost || undefined,
                imapPort: imapPort || undefined,
                smtpHost: smtpHost || undefined,
                smtpPort: smtpPort || undefined,
            });
        }
        catch (err) {
            setError(err.message || 'Failed to connect mailbox.');
            setLoading(false);
            return;
        }
        // Step 3: create the first bowl, claiming the address(es). Mail synced
        // from the mailbox routes here by address match.
        try {
            await createBowl(name, bowlColor, bowlAddresses[0], bowlAddresses);
        }
        catch (err) {
            setError(err.message || 'Failed to create bowl.');
            setLoading(false);
            return;
        }
        setLoading(false);
        setStep('success');
    }
    const stepNum = step === 'welcome' ? 0 : step === 'provider' ? 1 : step === 'credentials' ? 2 : 3;
    return (_jsxs("div", { className: styles.wrap, children: [_jsxs("div", { className: styles.logo, children: [_jsx("img", { src: "/favicon.svg", alt: "Cereal", className: styles.logoMark }), "Cereal"] }), _jsxs("div", { className: styles.card, children: [step === 'welcome' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.title, children: ["Every business", _jsx("br", {}), "in its own bowl."] }), _jsx("div", { className: styles.subtitle, children: "Connect your first email account and your inbox organizes itself by business, automatically." }), _jsx("button", { className: styles.btnPrimary, onClick: () => setStep('provider'), children: "Connect your first inbox \u2192" })] })), step === 'provider' && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.step, children: "Step 1 of 2" }), _jsx("div", { className: styles.title, children: "Where is your email?" }), _jsx("div", { className: styles.subtitle, children: "Pick your email provider." }), error && _jsx("div", { className: styles.error, children: error }), availableOAuth.size > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.oauthSection, children: OAUTH_PROVIDERS.filter(op => availableOAuth.has(op.id)).map(op => (_jsxs("button", { className: styles.oauthButton, onClick: () => selectOAuthProvider(op), children: [_jsx("span", { className: styles.oauthIcon, "aria-hidden": true, children: op.id === 'google' ? _jsx(GoogleLogo, {}) : _jsx(MicrosoftLogo, {}) }), _jsxs("span", { className: styles.oauthLabel, children: [_jsx("span", { className: styles.oauthName, children: op.name }), _jsx("span", { className: styles.oauthDesc, children: op.description })] })] }, op.id))) }), _jsx("div", { className: styles.oauthDivider, children: _jsx("span", { children: "or use IMAP" }) })] })), _jsx("div", { className: styles.providers, children: PROVIDERS.map(p => (_jsxs("button", { className: `${styles.providerTile} ${provider?.id === p.id ? styles.selected : ''}`, onClick: () => selectProvider(p), children: [_jsx("span", { className: styles.providerIcon, children: p.icon }), _jsx("span", { className: styles.providerName, children: p.name })] }, p.id))) }), _jsx("div", { className: styles.progress, children: [0, 1, 2].map(i => (_jsx("div", { className: `${styles.progressDot} ${stepNum >= i ? styles.active : ''}` }, i))) }), _jsx("button", { className: styles.btnBack, onClick: () => setStep('welcome'), children: "\u2190 Back" })] })), step === 'oauth_bowl' && oauthProvider && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.step, children: "Step 2 of 2" }), _jsx("div", { className: styles.title, children: "Set up your bowl" }), _jsxs("div", { className: styles.subtitle, children: ["You'll be redirected to ", oauthProvider.id === 'google' ? 'Google' : 'Microsoft', " to authorize after this."] }), error && _jsx("div", { className: styles.error, children: error }), _jsxs("div", { className: styles.fields, children: [_jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Bowl name" }), _jsx("input", { className: styles.fieldInput, type: "text", placeholder: oauthProvider.id === 'google' ? 'Gmail' : 'Outlook', value: bowlName, onChange: e => setBowlName(e.target.value), autoFocus: true })] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Bowl addresses" }), _jsxs("div", { className: styles.helpText, style: { marginTop: 0, marginBottom: 8 }, children: ["This bowl will show mail sent ", _jsx("strong", { children: "to" }), " or ", _jsx("strong", { children: "from" }), " these addresses, and nothing else. Add every address you use for this business."] }), _jsxs("div", { style: { display: 'flex', gap: '6px' }, children: [_jsx("input", { className: styles.fieldInput, type: "email", placeholder: "support@yourcompany.com, billing@yourcompany.com", value: addressInput, onChange: e => setAddressInput(e.target.value), onKeyDown: e => {
                                                            if (e.key === 'Enter' && addressInput.trim()) {
                                                                const tokens = tokenizeAddresses(addressInput);
                                                                if (tokens.length) {
                                                                    setAddresses(prev => [...new Set([...prev, ...tokens])]);
                                                                    setAddressInput('');
                                                                }
                                                                e.preventDefault();
                                                            }
                                                        }, style: { flex: 1 } }), _jsx("button", { type: "button", onClick: () => {
                                                            const tokens = tokenizeAddresses(addressInput);
                                                            if (tokens.length) {
                                                                setAddresses(prev => [...new Set([...prev, ...tokens])]);
                                                                setAddressInput('');
                                                            }
                                                        }, style: {
                                                            padding: '0 12px', background: 'var(--bg-hover)',
                                                            border: '1.5px solid var(--border-med)', borderRadius: 'var(--radius-sm)',
                                                            fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
                                                            fontFamily: 'var(--font-body)', color: 'var(--text-2)'
                                                        }, children: "Add" })] }), addresses.length > 0 && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }, children: addresses.map(addr => (_jsxs("span", { style: {
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                        fontSize: '0.75rem', padding: '2px 8px',
                                                        background: 'var(--bg-hover)', border: '1px solid var(--border-med)',
                                                        borderRadius: '100px', color: 'var(--text-2)'
                                                    }, children: [addr, _jsx("button", { onClick: () => setAddresses(prev => prev.filter(a => a !== addr)), style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-3)', fontSize: '0.8rem', lineHeight: 1 }, children: "\u00D7" })] }, addr))) }))] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Bowl color" }), _jsx("div", { className: styles.colors, children: BOWL_COLORS.map(c => (_jsx("button", { type: "button", className: `${styles.colorDot} ${bowlColor === c ? styles.colorActive : ''}`, style: { borderColor: c, background: bowlColor === c ? c : 'transparent' }, onClick: () => setBowlColor(c), "aria-label": `Color ${c}` }, c))) })] })] }), _jsx("button", { className: styles.btnPrimary, onClick: handleOAuthContinue, disabled: loading, children: loading ? 'Redirecting…' : `Continue with ${oauthProvider.id === 'google' ? 'Google' : 'Microsoft'} →` }), _jsx("button", { className: styles.btnBack, onClick: () => { setOauthProvider(null); setStep('provider'); }, children: "\u2190 Back" })] })), step === 'credentials' && provider && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.step, children: "Step 2 of 2" }), _jsxs("div", { className: styles.title, children: ["Connect ", provider.name] }), error && _jsx("div", { className: styles.error, children: error }), _jsxs("div", { className: styles.fields, children: [_jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Email address" }), _jsx("input", { className: styles.fieldInput, type: "email", placeholder: "you@example.com", value: email, onChange: e => setEmail(e.target.value), autoFocus: true, autoComplete: "email" })] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "App password" }), _jsx("input", { className: styles.fieldInput, type: "password", placeholder: "\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7", value: password, onChange: e => setPassword(e.target.value), autoComplete: "current-password", onKeyDown: e => e.key === 'Enter' && handleConnect() }), provider.helpText && (_jsxs("div", { className: styles.helpText, children: [provider.helpText, provider.helpUrl && (_jsxs(_Fragment, { children: [" ", _jsx("a", { href: provider.helpUrl, target: "_blank", rel: "noreferrer", children: "Generate one \u2192" })] }))] }))] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsxs("label", { className: styles.fieldLabel, children: ["Bowl name ", _jsx("span", { style: { fontWeight: 300, color: 'var(--text-3)' }, children: "(optional)" })] }), _jsx("input", { className: styles.fieldInput, type: "text", placeholder: deriveDefaultBowlName(email) || 'My Business', value: bowlName, onChange: e => setBowlName(e.target.value) })] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Bowl addresses" }), _jsxs("div", { className: styles.helpText, style: { marginTop: 0, marginBottom: 8 }, children: ["This bowl will show mail sent ", _jsx("strong", { children: "to" }), " or ", _jsx("strong", { children: "from" }), " these addresses, and nothing else. Add every address you use for this business \u2014 newsletters, support, billing, anything."] }), _jsxs("div", { style: { display: 'flex', gap: '6px' }, children: [_jsx("input", { className: styles.fieldInput, type: "email", placeholder: "support@yourcompany.com, billing@yourcompany.com", value: addressInput, onChange: e => setAddressInput(e.target.value), onKeyDown: e => {
                                                            if (e.key === 'Enter' && addressInput.trim()) {
                                                                const tokens = tokenizeAddresses(addressInput);
                                                                if (tokens.length) {
                                                                    setAddresses(prev => [...new Set([...prev, ...tokens])]);
                                                                    setAddressInput('');
                                                                }
                                                                e.preventDefault();
                                                            }
                                                        }, style: { flex: 1 } }), _jsx("button", { type: "button", onClick: () => {
                                                            const tokens = tokenizeAddresses(addressInput);
                                                            if (tokens.length) {
                                                                setAddresses(prev => [...new Set([...prev, ...tokens])]);
                                                                setAddressInput('');
                                                            }
                                                        }, style: {
                                                            padding: '0 12px', background: 'var(--bg-hover)',
                                                            border: '1.5px solid var(--border-med)', borderRadius: 'var(--radius-sm)',
                                                            fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
                                                            fontFamily: 'var(--font-body)', color: 'var(--text-2)'
                                                        }, children: "Add" })] }), addresses.length > 0 && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }, children: addresses.map(addr => (_jsxs("span", { style: {
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                        fontSize: '0.75rem', padding: '2px 8px',
                                                        background: 'var(--bg-hover)', border: '1px solid var(--border-med)',
                                                        borderRadius: '100px', color: 'var(--text-2)'
                                                    }, children: [addr, _jsx("button", { onClick: () => setAddresses(prev => prev.filter(a => a !== addr)), style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-3)', fontSize: '0.8rem', lineHeight: 1 }, children: "\u00D7" })] }, addr))) })), addresses.length === 0 && email.trim() && (_jsxs("div", { className: styles.helpText, style: { marginTop: '6px', fontSize: '0.75rem', opacity: 0.7 }, children: ["Leave empty to monitor mail sent to ", _jsx("strong", { children: email.trim().toLowerCase() }), "."] }))] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "Bowl color" }), _jsx("div", { style: { display: 'flex', gap: '8px', marginTop: '2px' }, children: BOWL_COLORS.map(c => (_jsx("button", { onClick: () => setBowlColor(c), style: {
                                                        width: 22, height: 22, borderRadius: '50%',
                                                        background: c, border: 'none', cursor: 'pointer',
                                                        outline: c === bowlColor ? `2.5px solid ${c}` : 'none',
                                                        outlineOffset: 2,
                                                        transform: c === bowlColor ? 'scale(1.2)' : 'scale(1)',
                                                        transition: 'all 0.15s',
                                                    } }, c))) })] })] }), showAdvanced && (_jsx("div", { className: styles.advanced, children: _jsxs("div", { className: styles.advancedFields, children: [_jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "IMAP Host" }), _jsx("input", { className: styles.fieldInput, type: "text", placeholder: "imap.example.com", value: imapHost, onChange: e => setImapHost(e.target.value) })] }), _jsxs("div", { className: styles.fieldWrap, style: { minWidth: 80 }, children: [_jsx("label", { className: styles.fieldLabel, children: "Port" }), _jsx("input", { className: styles.fieldInput, type: "number", value: imapPort, onChange: e => setImapPort(Number(e.target.value)) })] }), _jsxs("div", { className: styles.fieldWrap, children: [_jsx("label", { className: styles.fieldLabel, children: "SMTP Host" }), _jsx("input", { className: styles.fieldInput, type: "text", placeholder: "smtp.example.com", value: smtpHost, onChange: e => setSmtpHost(e.target.value) })] }), _jsxs("div", { className: styles.fieldWrap, style: { minWidth: 80 }, children: [_jsx("label", { className: styles.fieldLabel, children: "Port" }), _jsx("input", { className: styles.fieldInput, type: "number", value: smtpPort, onChange: e => setSmtpPort(Number(e.target.value)) })] })] }) })), provider.id !== 'imap' && (_jsxs("button", { className: styles.advancedToggle, onClick: () => setShowAdvanced(v => !v), children: [showAdvanced ? '▾' : '▸', " ", showAdvanced ? 'Hide' : 'Show', " advanced IMAP settings"] })), _jsxs("div", { style: { marginTop: '1.25rem' }, children: [_jsx("button", { className: styles.btnPrimary, onClick: handleConnect, disabled: loading, children: loading ? _jsxs(_Fragment, { children: [_jsx("div", { className: styles.spinner }), " Connecting\u2026"] }) : 'Connect →' }), _jsx("button", { className: styles.btnBack, onClick: () => { setStep('provider'); setError(''); }, children: "\u2190 Back" })] }), _jsx("div", { className: styles.progress, children: [0, 1, 2].map(i => (_jsx("div", { className: `${styles.progressDot} ${stepNum >= i ? styles.active : ''}` }, i))) })] })), step === 'success' && (_jsxs("div", { className: styles.success, children: [_jsx("div", { className: styles.successIcon, children: "\uD83E\uDD63" }), _jsx("div", { className: styles.successTitle, children: "Mailbox connected." }), _jsx("div", { className: styles.successSub, children: "Mail is syncing in the background." }), _jsx("button", { className: styles.btnPrimary, onClick: onComplete, style: { width: '100%' }, children: "Open your dashboard \u2192" })] }))] })] }));
}
function GoogleLogo() {
    return (_jsxs("svg", { width: "20", height: "20", viewBox: "0 0 48 48", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, children: [_jsx("path", { fill: "#FFC107", d: "M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" }), _jsx("path", { fill: "#FF3D00", d: "M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" }), _jsx("path", { fill: "#4CAF50", d: "M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2.1 1.6-4.7 2.5-7.2 2.5-5.2 0-9.7-3.3-11.3-8L6.1 33C9.5 39.6 16.2 44 24 44z" }), _jsx("path", { fill: "#1976D2", d: "M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" })] }));
}
function MicrosoftLogo() {
    return (_jsxs("svg", { width: "20", height: "20", viewBox: "0 0 23 23", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, children: [_jsx("path", { fill: "#f25022", d: "M1 1h10v10H1z" }), _jsx("path", { fill: "#7fba00", d: "M12 1h10v10H12z" }), _jsx("path", { fill: "#00a4ef", d: "M1 12h10v10H1z" }), _jsx("path", { fill: "#ffb900", d: "M12 12h10v10H12z" })] }));
}
