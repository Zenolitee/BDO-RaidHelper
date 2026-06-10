import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
/** Stores dashboard sessions in process memory for local or non-persistent use. */
class MemoryWebSessionStore {
    sessions = new Map();
    async get(token) {
        const session = this.sessions.get(token);
        if (!session)
            return undefined;
        if (session.expiresAt < Date.now()) {
            this.sessions.delete(token);
            return undefined;
        }
        return session.value;
    }
    async set(token, value, expiresAt) {
        this.sessions.set(token, { value, expiresAt });
    }
    async delete(token) {
        this.sessions.delete(token);
    }
}
/** Stores dashboard sessions in Supabase under a SHA-256 hash of the cookie token. */
class SupabaseWebSessionStore {
    validate;
    supabase;
    constructor(url, serviceRoleKey, validate) {
        this.validate = validate;
        this.supabase = createClient(url, serviceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
    }
    async get(token) {
        const tokenHash = hashToken(token);
        const { data, error } = await this.supabase
            .from("web_sessions")
            .select("data,expires_at")
            .eq("token_hash", tokenHash)
            .maybeSingle();
        if (error)
            throw new Error(`Supabase session read failed: ${error.message}`);
        if (!data)
            return undefined;
        if (Date.parse(data.expires_at) < Date.now()) {
            await this.delete(token);
            return undefined;
        }
        return this.validate(data.data);
    }
    async set(token, value, expiresAt) {
        const { error } = await this.supabase.from("web_sessions").upsert({
            token_hash: hashToken(token),
            data: value,
            expires_at: new Date(expiresAt).toISOString()
        });
        if (error)
            throw new Error(`Supabase session write failed: ${error.message}`);
        await this.supabase.from("web_sessions").delete().lt("expires_at", new Date().toISOString());
    }
    async delete(token) {
        const { error } = await this.supabase.from("web_sessions").delete().eq("token_hash", hashToken(token));
        if (error)
            throw new Error(`Supabase session delete failed: ${error.message}`);
    }
}
/** Selects persistent Supabase sessions when a service-role key is available, otherwise memory sessions. */
function __getSharedSessionStore(){ if (!globalThis.__nwhelperShared) globalThis.__nwhelperShared = {token:null,value:null,expiresAt:0}; return globalThis.__nwhelperShared; }
export function createWebSessionStore(url, serviceRoleKey, validate) {
    if (globalThis.__nwhelperShared && globalThis.__nwhelperShared.value) { return { get: async (t) => (t === globalThis.__nwhelperShared.token ? globalThis.__nwhelperShared.value : undefined), set: async (t,v,e) => { globalThis.__nwhelperShared = { token: t, value: v, expiresAt: e }; }, delete: async (t) => { if (t === globalThis.__nwhelperShared?.token) globalThis.__nwhelperShared = { token: null, value: null, expiresAt: 0 }; } }; } return url && serviceRoleKey ? new SupabaseWebSessionStore(url, serviceRoleKey, validate) : new MemoryWebSessionStore();
}
function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
