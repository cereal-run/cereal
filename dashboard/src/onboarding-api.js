const BASE = import.meta.env.VITE_API_BASE || '/api';
// Same token mechanism as api.ts — onboarding happens after login.
function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };
    const token = localStorage.getItem('cereal_token') || '';
    if (token)
        headers['x-session-token'] = token;
    return headers;
}
async function req(path, opts) {
    const res = await fetch(BASE + path, { headers: getHeaders(), ...opts });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
}
export async function testConnection(payload) {
    try {
        return await req('/onboarding/test', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
export async function createBowl(name, color, defaultFrom, addresses, isSpam = false, isInbox = false) {
    return req('/bowls', {
        method: 'POST',
        body: JSON.stringify({ name, color, defaultFrom, addresses, isSpam, isInbox }),
    });
}
export async function createAccount(payload) {
    return req('/accounts', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
export async function getOAuthAuthUrl(provider) {
    return req(`/oauth/${provider}/start`);
}
export async function getOAuthProviders() {
    return req('/oauth/providers');
}
