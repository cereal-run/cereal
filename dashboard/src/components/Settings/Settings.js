import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { CloseIcon } from '../Icons';
import { updateBowl, deleteBowl, getAccounts, getAgentKeys, createAgentKey, deleteAgentKey } from '../../api';
import { SpecialBowlsSetup } from '../SpecialBowlsSetup';
import styles from './Settings.module.css';
const COLORS = ['#ff6b35', '#e040a0', '#7b2fff', '#3a86ff'];
const GRID_PRESETS = [
    { label: '2×2', cols: 2 },
    { label: '3×2', cols: 3 },
    { label: '4×2', cols: 4 },
];
export function SettingsPanel({ bowls, onClose, onUpdateBowl, onDeleteBowl, onGridChange, currentCols, onLogout, theme, onThemeChange }) {
    const [tab, setTab] = useState('visual');
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.overlay, onClick: onClose }), _jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.header, children: [_jsx("span", { className: styles.title, children: "Settings" }), _jsx("button", { className: styles.closeBtn, onClick: onClose, children: _jsx(CloseIcon, { size: 11 }) })] }), _jsxs("div", { className: styles.tabs, children: [_jsx("button", { className: `${styles.tab} ${tab === 'visual' ? styles.tabActive : ''}`, onClick: () => setTab('visual'), children: "Visual" }), _jsx("button", { className: `${styles.tab} ${tab === 'shortcuts' ? styles.tabActive : ''}`, onClick: () => setTab('shortcuts'), children: "Shortcuts" }), _jsx("button", { className: `${styles.tab} ${tab === 'agents' ? styles.tabActive : ''}`, onClick: () => setTab('agents'), children: "Agent keys" }), _jsx("button", { className: `${styles.tab} ${tab === 'technical' ? styles.tabActive : ''}`, onClick: () => setTab('technical'), children: "Technical" })] }), _jsxs("div", { className: styles.body, children: [tab === 'visual' && (_jsx(VisualTab, { bowls: bowls, onUpdateBowl: onUpdateBowl, onDeleteBowl: onDeleteBowl, onGridChange: onGridChange, currentCols: currentCols, theme: theme, onThemeChange: onThemeChange })), tab === 'shortcuts' && _jsx(ShortcutsTab, {}), tab === 'agents' && _jsx(AgentsTab, {}), tab === 'technical' && (_jsx(TechnicalTab, { bowls: bowls, onUpdateBowl: onUpdateBowl, onLogout: onLogout }))] })] })] }));
}
function ShortcutsTab() {
    const items = [
        { keys: ['?'], desc: 'Show shortcuts overlay' },
        { keys: ['/'], desc: 'Focus search' },
        { keys: ['⌘', 'K'], desc: 'Open search' },
        { keys: ['S'], desc: 'Open settings' },
        { keys: ['R'], desc: 'Refresh all bowls' },
        { keys: ['Esc'], desc: 'Close any modal' },
        { keys: ['1', '–', '9'], desc: 'Jump to bowl 1 through 9' },
    ];
    return (_jsxs("div", { className: styles.section, children: [_jsx("div", { style: { fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 14 }, children: "Cereal works fast with the keyboard. These shortcuts work from anywhere in the app, except when you're typing in a field." }), items.map((s, i) => (_jsxs("div", { style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--border)',
                }, children: [_jsx("span", { style: { fontSize: 13, color: 'var(--text-1)' }, children: s.desc }), _jsx("div", { style: { display: 'flex', gap: 4 }, children: s.keys.map((k, ki) => (_jsx("kbd", { style: {
                                display: 'inline-block',
                                padding: '2px 7px', fontSize: 11, fontWeight: 600,
                                fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
                                background: 'var(--bg)', border: '1px solid var(--border-med)',
                                borderRadius: 4, color: 'var(--text-2)',
                                minWidth: 20, textAlign: 'center', lineHeight: 1.4,
                            }, children: k }, ki))) })] }, i)))] }));
}
function VisualTab({ bowls, onUpdateBowl, onDeleteBowl, onGridChange, currentCols, theme, onThemeChange }) {
    return (_jsxs("div", { className: styles.section, children: [_jsx("div", { className: styles.sectionTitle, children: "Theme" }), _jsxs("div", { className: styles.gridPicker, children: [_jsx("button", { className: `${styles.gridOpt} ${theme === 'light' ? styles.gridOptActive : ''}`, onClick: () => onThemeChange('light'), children: "Light" }), _jsx("button", { className: `${styles.gridOpt} ${theme === 'dark' ? styles.gridOptActive : ''}`, onClick: () => onThemeChange('dark'), children: "Dark" })] }), _jsx("div", { className: styles.sectionTitle, style: { marginTop: 20 }, children: "Grid layout" }), _jsx("div", { className: styles.gridPicker, children: GRID_PRESETS.map(p => (_jsx("button", { className: `${styles.gridOpt} ${p.cols === currentCols ? styles.gridOptActive : ''}`, onClick: () => onGridChange(p.cols, 2), children: p.label }, p.cols))) }), _jsx("div", { className: styles.sectionTitle, style: { marginTop: 20 }, children: "Bowls" }), bowls.map(bowl => (_jsx(BowlRow, { bowl: bowl, onUpdate: onUpdateBowl, onDelete: onDeleteBowl }, bowl.id)))] }));
}
function BowlRow({ bowl, onUpdate, onDelete }) {
    const [editingName, setEditingName] = useState(false);
    const [name, setName] = useState(bowl.name);
    const [confirmDelete, setConfirmDelete] = useState(false);
    function saveName() {
        if (name.trim() && name !== bowl.name) {
            updateBowl(bowl.id, { name: name.trim() }).catch(() => { });
            onUpdate(bowl.id, { name: name.trim() });
        }
        setEditingName(false);
    }
    function saveColor(color) {
        updateBowl(bowl.id, { color }).catch(() => { });
        onUpdate(bowl.id, { color });
    }
    function handleDelete() {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        deleteBowl(bowl.id).then(() => onDelete(bowl.id)).catch(() => { });
    }
    return (_jsxs("div", { className: styles.bowlRow, children: [_jsx("div", { className: styles.bowlRowDot, style: { background: bowl.color } }), editingName ? (_jsx("input", { className: styles.bowlNameInput, value: name, onChange: e => setName(e.target.value), onBlur: saveName, onKeyDown: e => { if (e.key === 'Enter')
                    saveName(); if (e.key === 'Escape') {
                    setName(bowl.name);
                    setEditingName(false);
                } }, autoFocus: true })) : (_jsx("span", { className: styles.bowlRowName, onClick: () => setEditingName(true), children: bowl.name })), _jsxs("div", { className: styles.swatchRow, children: [COLORS.map(c => {
                        const selected = c === bowl.color;
                        return (_jsx("button", { className: styles.swatchBtn, style: {
                                background: c,
                                outline: selected ? `2px solid ${c}` : 'none',
                            }, onClick: () => saveColor(c) }, c));
                    }), _jsxs("label", { style: { position: 'relative', cursor: 'pointer', display: 'inline-block' }, children: [_jsx("input", { type: "color", value: bowl.color, onChange: e => saveColor(e.target.value), style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' } }), _jsx("div", { className: styles.swatchBtn, style: {
                                    background: 'conic-gradient(#ff6b35, #f59e0b, #06d6a0, #3a86ff, #7b2fff, #e040a0, #ff6b35)',
                                    outline: !COLORS.includes(bowl.color) ? `2px solid ${bowl.color}` : 'none',
                                } })] })] }), _jsx("button", { onClick: handleDelete, onBlur: () => setConfirmDelete(false), style: {
                    marginLeft: '0.5rem', padding: '0.2rem 0.5rem', borderRadius: 6,
                    border: '1px solid var(--border)', background: confirmDelete ? '#ef4444' : 'transparent',
                    color: confirmDelete ? '#fff' : 'var(--text-3)', fontSize: '0.65rem', cursor: 'pointer',
                    fontWeight: confirmDelete ? 600 : 400, transition: 'all 0.15s',
                }, children: confirmDelete ? 'Confirm?' : '×' })] }));
}
function TechnicalTab({ bowls, onUpdateBowl, onLogout }) {
    const [accounts, setAccounts] = useState([]);
    const [expandedBowl, setExpandedBowl] = useState(null);
    useEffect(() => {
        getAccounts().then(setAccounts).catch(() => { });
    }, []);
    return (_jsxs("div", { children: [_jsxs("div", { className: styles.section, children: [_jsx("div", { className: styles.sectionTitle, children: "Bowls & addresses" }), _jsx("div", { style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 12 }, children: "Mail is routed to bowls by To: address. Add every address that should land in each bowl." }), bowls.filter(b => !b.isInbox && !b.isSpam && !b.isAgent).map(bowl => (_jsx(BowlAddressRow, { bowl: bowl, expanded: expandedBowl === bowl.id, onToggle: () => setExpandedBowl(expandedBowl === bowl.id ? null : bowl.id), onUpdate: onUpdateBowl }, bowl.id)))] }), _jsxs("div", { className: styles.section, children: [_jsx("div", { className: styles.sectionTitle, children: "Special bowls" }), _jsx("div", { style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 12 }, children: "Optional bowls for spam catch-all and agent messages. Skip either if you don't need it." }), _jsx(SpecialBowlsSetup, {})] }), _jsxs("div", { className: styles.section, children: [_jsx("div", { className: styles.sectionTitle, children: "Connected accounts" }), accounts.length === 0 && (_jsx("div", { style: { fontSize: '12px', color: 'var(--text-3)' }, children: "No accounts connected" })), accounts.map(a => (_jsxs("div", { className: styles.accountRow, children: [_jsx("div", { className: styles.accountInfo, children: _jsx("div", { className: styles.accountName, children: a.label }) }), _jsx("span", { className: `${styles.accountStatus} ${a.connected ? styles.statusConnected : styles.statusOffline}`, children: a.connected ? 'Connected' : 'Offline' })] }, a.id)))] }), _jsx("div", { className: styles.section, children: _jsx("button", { className: styles.logoutBtn, onClick: onLogout, children: "Log out" }) })] }));
}
function BowlAddressRow({ bowl, expanded, onToggle, onUpdate }) {
    const [addresses, setAddresses] = useState(bowl.addresses);
    const [defaultFrom, setDefaultFrom] = useState(bowl.defaultFrom ?? '');
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    function addAddress() {
        const addr = input.trim().toLowerCase();
        if (!addr)
            return;
        if (!addr.includes('@') || !addr.split('@')[1]?.includes('.')) {
            setError('Enter a valid email address.');
            return;
        }
        if (addresses.includes(addr)) {
            setError('Already added.');
            return;
        }
        setError('');
        const next = [...addresses, addr];
        setAddresses(next);
        if (!defaultFrom)
            setDefaultFrom(addr);
        setInput('');
    }
    function removeAddress(addr) {
        const next = addresses.filter(a => a !== addr);
        setAddresses(next);
        if (defaultFrom === addr)
            setDefaultFrom(next[0] ?? '');
    }
    async function save() {
        setSaving(true);
        setError('');
        try {
            await updateBowl(bowl.id, { addresses, defaultFrom: defaultFrom || undefined });
            onUpdate(bowl.id, { addresses, defaultFrom: defaultFrom || null });
            onToggle();
        }
        catch (err) {
            setError(err.message || 'Failed to save.');
        }
        setSaving(false);
    }
    return (_jsxs("div", { style: {
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 8,
            overflow: 'hidden',
            background: 'var(--bg-card)',
        }, children: [_jsxs("button", { onClick: onToggle, style: {
                    width: '100%',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                }, children: [_jsx("div", { style: { width: 9, height: 9, borderRadius: '50%', background: bowl.color, flexShrink: 0 } }), _jsx("span", { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-1)', flex: 1, letterSpacing: '-0.005em' }, children: bowl.name }), _jsxs("span", { style: { fontSize: 11, color: 'var(--text-3)' }, children: [bowl.addresses.length, " address", bowl.addresses.length !== 1 ? 'es' : ''] }), _jsx("svg", { width: "10", height: "10", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", style: { color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }, children: _jsx("polyline", { points: "9 18 15 12 9 6" }) })] }), expanded && (_jsxs("div", { style: {
                    padding: '4px 12px 12px',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--surface)',
                }, children: [addresses.length > 0 && (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }, children: [addresses.map(addr => (_jsxs("div", { style: {
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '6px 8px',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                }, children: [_jsx("button", { onClick: () => setDefaultFrom(addr), title: defaultFrom === addr ? 'Default send-as' : 'Set as default', style: {
                                            background: 'transparent', border: 'none', cursor: 'pointer',
                                            color: defaultFrom === addr ? '#c2710c' : 'var(--text-faint)',
                                            fontSize: 13, padding: 0, lineHeight: 1, width: 16,
                                        }, children: defaultFrom === addr ? '★' : '☆' }), _jsx("span", { style: { flex: 1, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: addr }), _jsx("button", { onClick: () => removeAddress(addr), style: {
                                            background: 'transparent', border: 'none', cursor: 'pointer',
                                            color: 'var(--text-3)', fontSize: 14, padding: 0, lineHeight: 1, width: 16,
                                        }, children: "\u00D7" })] }, addr))), _jsx("div", { style: { fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }, children: "\u2605 default send-as address" })] })), error && (_jsx("div", { style: { fontSize: 11, color: '#dc2626', marginTop: 8 }, children: error })), _jsxs("div", { style: { display: 'flex', gap: 6, marginTop: 10 }, children: [_jsx("input", { type: "email", placeholder: "contact@yourdomain.com", value: input, onChange: e => { setInput(e.target.value); setError(''); }, onKeyDown: e => e.key === 'Enter' && addAddress(), style: {
                                    flex: 1,
                                    padding: '7px 10px',
                                    fontSize: 12,
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-1)',
                                    outline: 'none',
                                    fontFamily: 'inherit',
                                } }), _jsx("button", { onClick: addAddress, style: {
                                    padding: '7px 12px',
                                    fontSize: 12,
                                    fontWeight: 500,
                                    background: 'var(--text-1)',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }, children: "Add" })] }), _jsx("button", { onClick: save, disabled: saving, style: {
                            width: '100%',
                            marginTop: 10,
                            padding: '8px',
                            fontSize: 12,
                            fontWeight: 500,
                            background: 'transparent',
                            border: '1px solid var(--border-med)',
                            borderRadius: 6,
                            cursor: saving ? 'default' : 'pointer',
                            color: 'var(--text-1)',
                            fontFamily: 'inherit',
                            opacity: saving ? 0.5 : 1,
                        }, children: saving ? 'Saving…' : 'Save changes' })] }))] }));
}
// ── Agents tab: manage external agent API keys ──────────────────────────────
function AgentsTab() {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [justCreatedKey, setJustCreatedKey] = useState(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        getAgentKeys().then(res => { setKeys(res.keys); setLoading(false); }).catch(() => setLoading(false));
    }, []);
    async function handleCreate() {
        if (!newLabel.trim())
            return;
        setCreating(true);
        try {
            const res = await createAgentKey(newLabel.trim());
            setJustCreatedKey({ key: res.key, label: res.label });
            setNewLabel('');
            const fresh = await getAgentKeys();
            setKeys(fresh.keys);
        }
        catch { }
        setCreating(false);
    }
    async function handleDelete(id) {
        if (!confirm('Revoke this agent key? Any scripts using it will stop working.'))
            return;
        await deleteAgentKey(id);
        const fresh = await getAgentKeys();
        setKeys(fresh.keys);
    }
    function copyKey(key) {
        navigator.clipboard.writeText(key).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }
    const apiBase = import.meta.env.VITE_API_BASE || 'https://your-cereal-backend';
    return (_jsxs("div", { style: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: 'var(--text-2)', lineHeight: 1.55 }, children: "Agent keys let external scripts and AI agents (Claude Code, Cursor, custom bots) post messages directly into your agent bowl. Each key has a label so you can revoke individual integrations." }), justCreatedKey && (_jsxs("div", { style: {
                    padding: '0.9rem', borderRadius: 10, background: 'rgba(6,214,160,0.08)',
                    border: '1px solid rgba(6,214,160,0.25)',
                }, children: [_jsxs("div", { style: { fontSize: '0.72rem', fontWeight: 600, color: '#06d6a0', marginBottom: 6 }, children: ["\u2713 Key created for \"", justCreatedKey.label, "\""] }), _jsx("div", { style: { fontSize: '0.7rem', color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.5 }, children: "Copy this key now. For security, you won't see it again." }), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx("code", { style: {
                                    flex: 1, fontSize: '0.7rem', padding: '0.4rem 0.6rem',
                                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                                    fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }, children: justCreatedKey.key }), _jsx("button", { onClick: () => copyKey(justCreatedKey.key), style: {
                                    padding: '0.4rem 0.7rem', fontSize: '0.7rem',
                                    background: copied ? '#06d6a0' : 'var(--bg)', color: copied ? '#000' : 'var(--text-1)',
                                    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                                    fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.15s',
                                }, children: copied ? 'Copied' : 'Copy' }), _jsx("button", { onClick: () => setJustCreatedKey(null), style: {
                                    padding: '0.4rem 0.6rem', fontSize: '0.7rem',
                                    background: 'transparent', color: 'var(--text-3)',
                                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                }, children: "Dismiss" })] })] })), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Create new key" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("input", { value: newLabel, onChange: e => setNewLabel(e.target.value), placeholder: "e.g. Claude Code, GitHub Actions, Deploy bot", onKeyDown: e => e.key === 'Enter' && handleCreate(), style: {
                                    flex: 1, padding: '0.45rem 0.7rem', fontSize: '0.78rem',
                                    border: '1px solid var(--border)', borderRadius: 6,
                                    background: 'var(--bg)', color: 'var(--text-1)',
                                    outline: 'none', fontFamily: 'inherit',
                                } }), _jsx("button", { onClick: handleCreate, disabled: creating || !newLabel.trim(), style: {
                                    padding: '0.45rem 0.9rem', fontSize: '0.78rem',
                                    background: 'var(--text-1)', color: 'var(--bg)',
                                    border: 'none', borderRadius: 6, cursor: creating ? 'default' : 'pointer',
                                    fontFamily: 'inherit', fontWeight: 500, opacity: !newLabel.trim() ? 0.4 : 1,
                                }, children: creating ? 'Creating…' : 'Generate' })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Active keys" }), loading && _jsx("div", { style: { fontSize: '0.75rem', color: 'var(--text-3)' }, children: "Loading\u2026" }), !loading && keys.length === 0 && (_jsx("div", { style: { fontSize: '0.75rem', color: 'var(--text-3)', padding: '0.6rem 0' }, children: "No keys yet. Create one above to let an agent post to your agent bowl." })), keys.map(k => (_jsxs("div", { style: {
                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                            padding: '0.55rem 0', borderBottom: '1px solid var(--border)',
                        }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: 'var(--text-1)', fontWeight: 500 }, children: k.label }), _jsxs("div", { style: {
                                            fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 1,
                                            fontFamily: 'ui-monospace, monospace',
                                        }, children: [k.keyPreview, " \u00B7 agentId: ", k.agentId, k.lastUsed && ` · last used ${formatRelative(k.lastUsed)}`, !k.lastUsed && ' · never used'] })] }), _jsx("button", { onClick: () => handleDelete(k.id), title: "Revoke this key", style: {
                                    padding: '0.3rem 0.6rem', fontSize: '0.68rem',
                                    background: 'transparent', color: 'var(--text-3)',
                                    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }, children: "Revoke" })] }, k.id)))] }), _jsxs("div", { style: {
                    padding: '0.85rem', borderRadius: 8,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    fontSize: '0.7rem', color: 'var(--text-2)', lineHeight: 1.55,
                }, children: [_jsx("div", { style: { fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }, children: "Usage example" }), _jsxs("div", { style: { marginBottom: 6 }, children: ["POST to ", _jsxs("code", { style: { background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem' }, children: [apiBase, "/agent/inbound"] }), " with your key:"] }), _jsx("pre", { style: {
                            margin: '6px 0 0', padding: '0.6rem', background: 'var(--bg)',
                            border: '1px solid var(--border)', borderRadius: 6,
                            fontSize: '0.65rem', fontFamily: 'ui-monospace, monospace',
                            overflow: 'auto', lineHeight: 1.5,
                        }, children: `curl ${apiBase}/agent/inbound \\
  -H "X-Agent-Key: cereal_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Tests passing on main", "type": "notification"}'` })] })] }));
}
function formatRelative(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000)
        return 'just now';
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)
        return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}
