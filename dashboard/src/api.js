const BASE = import.meta.env.VITE_API_BASE || '/api';
// Session token storage. Replaces the old API-key model entirely — the
// `VITE_API_KEY` env var is no longer read or fallen back to. If no token
// is in localStorage, requests will fail with 401 and the UI shows the
// login screen.
const TOKEN_KEY = 'cereal_token';
function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
}
function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };
    const token = getToken();
    if (token)
        headers['x-session-token'] = token;
    return headers;
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}
export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}
export function hasToken() {
    return Boolean(getToken());
}
export async function signup(email, password, inviteCode) {
    const res = await fetch(BASE + '/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, inviteCode }),
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || 'Sign up failed');
    setToken(data.token);
    return data;
}
export async function login(email, password) {
    const res = await fetch(BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || 'Login failed');
    setToken(data.token);
    return data;
}
export async function logout() {
    try {
        await fetch(BASE + '/auth/logout', {
            method: 'POST',
            headers: getHeaders(),
        });
    }
    catch {
        // Network errors on logout are fine — we still clear the local token.
    }
    clearToken();
}
export async function forgotPassword(email) {
    const res = await fetch(BASE + '/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    // The endpoint always returns ok for valid requests (no account
    // enumeration). Only rate limiting or a server error produces non-2xx.
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not send reset email. Try again in a few minutes.');
    }
}
export async function resetPassword(token, newPassword) {
    const res = await fetch(BASE + '/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Password reset failed');
    }
}
export async function me() {
    const token = getToken();
    if (!token)
        return null;
    const res = await fetch(BASE + '/auth/me', { headers: getHeaders() });
    if (!res.ok) {
        // Token rejected — clear it so the next render shows login.
        clearToken();
        return null;
    }
    const data = await res.json();
    return data.user;
}
async function req(path, opts) {
    const res = await fetch(BASE + path, { headers: getHeaders(), ...opts });
    if (!res.ok) {
        // 401 means the session is gone. Clear the token so the next render
        // shows the login screen. Dispatch an event so App.tsx can react
        // immediately without waiting for the next mount.
        if (res.status === 401) {
            clearToken();
            window.dispatchEvent(new Event('cereal:auth-expired'));
        }
        let msg = `${res.status} ${res.statusText}`;
        try {
            const body = await res.json();
            if (body.error)
                msg = body.error;
        }
        catch { }
        throw new Error(msg);
    }
    return res.json();
}
// ── Bowls ──────────────────────────────────────────────────────────────────────
export async function getBowls() {
    return req('/bowls');
}
// ── Messages ───────────────────────────────────────────────────────────────────
export async function getMessages(bowlId, opts = {}) {
    const p = new URLSearchParams();
    if (opts.limit)
        p.set('limit', String(opts.limit));
    if (opts.offset)
        p.set('offset', String(opts.offset));
    if (opts.unreadOnly)
        p.set('unreadOnly', 'true');
    return req(`/bowls/${bowlId}/messages?${p}`);
}
// Trigger a server-side IMAP sync for a bowl, then resolve once it's done.
// The backend re-fetches from the mail server and pushes any new messages
// over the WebSocket as they land. We await the HTTP response so the caller
// can stop showing a spinner; the actual new-message rendering happens via
// the WS 'new_message' events that follow.
export async function resyncBowl(bowlId) {
    return req(`/bowls/${bowlId}/resync`, { method: 'POST' });
}
export async function searchMessages(bowlId, q) {
    return req(`/bowls/${bowlId}/messages/search?q=${encodeURIComponent(q)}`);
}
// Search across ALL bowls
export async function searchAll(q, limit = 30) {
    return req(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}
export async function getMessageBody(accountId, uid, folder = 'INBOX') {
    return req(`/accounts/${accountId}/messages/${uid}/body?folder=${folder}`);
}
export async function markSeen(accountId, uids, folder = 'INBOX') {
    return req('/messages/seen', {
        method: 'POST',
        body: JSON.stringify({ accountId, uids, folder }),
    });
}
export async function markUnseen(accountId, uids, folder = 'INBOX') {
    return req('/messages/unseen', {
        method: 'POST',
        body: JSON.stringify({ accountId, uids, folder }),
    });
}
export async function sendEmail(payload) {
    return req('/send', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
// ── Agent channel ──────────────────────────────────────────────────────────────
export async function getAgentMessages(bowlId, limit = 50) {
    const p = new URLSearchParams({ limit: String(limit) });
    if (bowlId)
        p.set('bowlId', bowlId);
    return req(`/agent/messages?${p}`);
}
export async function sendToAgent(agentId, content, bowlId) {
    return req('/human/messages', {
        method: 'POST',
        body: JSON.stringify({ agentId, content, bowlId }),
    });
}
export async function resolveDecision(id, resolution) {
    return req(`/agent/messages/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
    });
}
// ── Compose context ────────────────────────────────────────────────────────────
export async function getComposeContext(bowlId) {
    return req(`/compose/context/${bowlId}`);
}
// ── Status ─────────────────────────────────────────────────────────────────────
export async function updateBowl(bowlId, updates) {
    return req(`/bowls/${bowlId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}
export async function deleteBowl(bowlId) {
    return req(`/bowls/${bowlId}`, {
        method: 'DELETE',
    });
}
// ── Special bowls: spam + agent ───────────────────────────────────────────────
// Both are optional. The dashboard's Settings page reads getSpecialBowls()
// to decide whether to show "Set up" buttons or "Configured" panels.
export async function getSpecialBowls() {
    return req('/bowls/special');
}
export async function setupSpamBowl(opts) {
    return req('/bowls/spam/setup', {
        method: 'POST',
        body: JSON.stringify(opts),
    });
}
export async function setupAgentBowl(opts) {
    return req('/bowls/agent/setup', {
        method: 'POST',
        body: JSON.stringify(opts),
    });
}
export async function getAgentKeys() {
    return req('/agent/keys');
}
export async function createAgentKey(label, agentId) {
    return req('/agent/keys', {
        method: 'POST',
        body: JSON.stringify({ label, agentId }),
    });
}
export async function deleteAgentKey(id) {
    return req(`/agent/keys/${id}`, { method: 'DELETE' });
}
export async function getAccounts() {
    // Previously called /status (which used to expose every account globally).
    // /status is now a minimal liveness check; account listing moved to the
    // authenticated /accounts endpoint scoped to the current user.
    const resp = await req('/accounts');
    return resp.accounts;
}
