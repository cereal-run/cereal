import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getSpecialBowls, setupSpamBowl, setupAgentBowl, deleteBowl, getAccounts, } from '../api';
import styles from './SpecialBowlsSetup.module.css';
// Self-contained component covering optional spam + agent bowl setup.
//
// Drop it into your Settings page wherever it fits. Both features are
// strictly opt-in. Users who don't care about either never touch them.
//
// Usage:
//   <SpecialBowlsSetup />
//
// Backend dependencies:
//   GET  /bowls/special              → { spam, agent }
//   POST /bowls/spam/setup           → { ok, bowl, created }
//   POST /bowls/agent/setup          → { ok, bowl, created }
//   DELETE /bowls/:id                → { ok }
const COLOR_OPTIONS = [
    '#9ca3af', // gray (spam default)
    '#ffbe0b', // yellow (agent default)
    '#ff6b35', // orange
    '#3a86ff', // blue
    '#7b2fff', // purple
    '#06d6a0', // green
    '#f72585', // pink
    '#ff4757', // red
];
export function SpecialBowlsSetup() {
    const [loading, setLoading] = useState(true);
    const [spam, setSpam] = useState(null);
    const [agent, setAgent] = useState(null);
    const [accounts, setAccounts] = useState([]);
    useEffect(() => {
        void refresh();
    }, []);
    async function refresh() {
        setLoading(true);
        try {
            const [special, accts] = await Promise.all([
                getSpecialBowls(),
                getAccounts(),
            ]);
            setSpam(special.spam);
            setAgent(special.agent);
            setAccounts(accts);
        }
        finally {
            setLoading(false);
        }
    }
    if (loading) {
        return _jsx("div", { className: styles.loading, children: "Loading\u2026" });
    }
    return (_jsxs("div", { className: styles.container, children: [_jsx(SpamSection, { bowl: spam, accounts: accounts, onChange: refresh }), _jsx(AgentSection, { bowl: agent, onChange: refresh })] }));
}
// ── Spam bowl section ───────────────────────────────────────────────────────
function SpamSection(props) {
    const { bowl, accounts, onChange } = props;
    const [open, setOpen] = useState(false);
    if (bowl) {
        return (_jsxs("section", { className: styles.section, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.titleRow, children: [_jsx("span", { className: styles.dot, style: { background: bowl.color } }), _jsx("h3", { className: styles.title, children: "Spam bowl" }), _jsx("span", { className: styles.badgeOk, children: "Configured" })] }), _jsxs("p", { className: styles.subtitle, children: ["All catch-all mail lands in ", _jsx("strong", { children: bowl.name }), ".", bowl.defaultFrom && (_jsxs(_Fragment, { children: [" Routing from ", _jsx("code", { children: bowl.defaultFrom }), "."] }))] })] }), _jsx(DisconnectButton, { bowl: bowl, label: "Spam bowl", onConfirm: onChange })] }));
    }
    return (_jsxs("section", { className: styles.section, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.titleRow, children: [_jsx("span", { className: styles.dotMuted }), _jsx("h3", { className: styles.title, children: "Spam bowl" }), _jsx("span", { className: styles.badgeOpt, children: "Optional" })] }), _jsx("p", { className: styles.subtitle, children: "A dedicated bowl for sketchy signups. Connect a catch-all domain and every alias you've ever given out lands here. Verification codes surface front and center, your real inboxes stay clean." })] }), !open ? (_jsx("button", { className: styles.cta, onClick: () => setOpen(true), children: "Set up spam bowl" })) : (_jsx(SpamForm, { accounts: accounts, onCancel: () => setOpen(false), onCreated: () => { setOpen(false); onChange(); } }))] }));
}
function SpamForm(props) {
    const { accounts, onCancel, onCreated } = props;
    const [name, setName] = useState('Spam');
    const [color, setColor] = useState(COLOR_OPTIONS[0]);
    const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await setupSpamBowl({
                name,
                color,
                accountId: accountId || undefined,
            });
            onCreated();
        }
        catch (e) {
            setError(e?.message ?? 'Something went wrong.');
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: styles.form, children: [accounts.length === 0 ? (_jsx("p", { className: styles.notice, children: "You haven't connected any mail accounts yet. Connect your throwaway domain as an account first, then come back to set up the spam bowl. You can also create the bowl without an account and link one later." })) : (_jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.fieldLabel, children: "Catch-all account" }), _jsxs("select", { className: styles.select, value: accountId, onChange: (e) => setAccountId(e.target.value), children: [_jsx("option", { value: "", children: "\u2014 None for now \u2014" }), accounts.map((a) => (_jsxs("option", { value: a.id, children: [a.label, " (", a.username, ")"] }, a.id)))] })] })), _jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.fieldLabel, children: "Bowl name" }), _jsx("input", { className: styles.input, value: name, onChange: (e) => setName(e.target.value), maxLength: 50 })] }), _jsx(ColorPicker, { value: color, onChange: setColor }), error && _jsx("p", { className: styles.error, children: error }), _jsxs("div", { className: styles.actions, children: [_jsx("button", { className: styles.cancel, onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { className: styles.submit, onClick: submit, disabled: busy || !name.trim(), children: busy ? 'Creating…' : 'Create spam bowl' })] })] }));
}
// ── Agent bowl section ──────────────────────────────────────────────────────
function AgentSection(props) {
    const { bowl, onChange } = props;
    const [open, setOpen] = useState(false);
    if (bowl) {
        return (_jsxs("section", { className: styles.section, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.titleRow, children: [_jsx("span", { className: styles.dot, style: { background: bowl.color } }), _jsx("h3", { className: styles.title, children: "Agent bowl" }), _jsx("span", { className: styles.badgeOk, children: "Configured" })] }), _jsxs("p", { className: styles.subtitle, children: ["Agent messages route to ", _jsx("strong", { children: bowl.name }), ". Generate an agent key in ", _jsx("em", { children: "Agent keys" }), " below, then have your agent POST to ", _jsx("code", { children: "/agent/inbound" }), "."] })] }), _jsx(DisconnectButton, { bowl: bowl, label: "Agent bowl", onConfirm: onChange })] }));
    }
    return (_jsxs("section", { className: styles.section, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.titleRow, children: [_jsx("span", { className: styles.dotMuted }), _jsx("h3", { className: styles.title, children: "Agent bowl" }), _jsx("span", { className: styles.badgeOpt, children: "Optional" })] }), _jsx("p", { className: styles.subtitle, children: "A bowl where your AI agents communicate with you. Task completions, status updates, decision requests. Not Slack, not Telegram, just inside your cockpit. Skip if you don't use agents." })] }), !open ? (_jsx("button", { className: styles.cta, onClick: () => setOpen(true), children: "Set up agent bowl" })) : (_jsx(AgentForm, { onCancel: () => setOpen(false), onCreated: () => { setOpen(false); onChange(); } }))] }));
}
function AgentForm(props) {
    const { onCancel, onCreated } = props;
    const [name, setName] = useState('Agent');
    const [color, setColor] = useState('#ffbe0b');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await setupAgentBowl({ name, color });
            onCreated();
        }
        catch (e) {
            setError(e?.message ?? 'Something went wrong.');
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.fieldLabel, children: "Bowl name" }), _jsx("input", { className: styles.input, value: name, onChange: (e) => setName(e.target.value), maxLength: 50 })] }), _jsx(ColorPicker, { value: color, onChange: setColor }), error && _jsx("p", { className: styles.error, children: error }), _jsxs("div", { className: styles.actions, children: [_jsx("button", { className: styles.cancel, onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { className: styles.submit, onClick: submit, disabled: busy || !name.trim(), children: busy ? 'Creating…' : 'Create agent bowl' })] })] }));
}
// ── Shared bits ─────────────────────────────────────────────────────────────
function ColorPicker(props) {
    return (_jsxs("div", { className: styles.field, children: [_jsx("span", { className: styles.fieldLabel, children: "Color" }), _jsx("div", { className: styles.colorRow, children: COLOR_OPTIONS.map((c) => (_jsx("button", { type: "button", className: `${styles.colorSwatch} ${props.value === c ? styles.colorActive : ''}`, style: { background: c }, onClick: () => props.onChange(c), "aria-label": `Pick ${c}` }, c))) })] }));
}
function DisconnectButton(props) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    async function go() {
        setBusy(true);
        try {
            await deleteBowl(props.bowl.id);
            props.onConfirm();
        }
        finally {
            setBusy(false);
            setConfirming(false);
        }
    }
    if (!confirming) {
        return (_jsxs("button", { className: styles.disconnect, onClick: () => setConfirming(true), children: ["Disconnect ", props.label.toLowerCase()] }));
    }
    return (_jsxs("div", { className: styles.confirm, children: [_jsx("span", { children: "Disconnect and delete this bowl? Messages inside will be lost." }), _jsxs("div", { className: styles.confirmActions, children: [_jsx("button", { className: styles.cancel, onClick: () => setConfirming(false), disabled: busy, children: "Cancel" }), _jsx("button", { className: styles.confirmDelete, onClick: go, disabled: busy, children: busy ? 'Removing…' : 'Yes, disconnect' })] })] }));
}
