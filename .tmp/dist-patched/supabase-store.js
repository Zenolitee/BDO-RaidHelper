import { createClient } from "@supabase/supabase-js";
import { EventStore, validateStoreData } from "./store.js";
const STORE_KEY = "default";
/** Persists the shared event-store document in the Supabase `nodewar_store` table. */
export class SupabaseEventStore extends EventStore {
    supabase;
    constructor(url, serviceRoleKey) {
        super("__supabase__");
        this.supabase = createClient(url, serviceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
    }
    async read() {
        const { data, error } = await this.supabase
            .from("nodewar_store")
            .select("key,data")
            .eq("key", STORE_KEY)
            .maybeSingle();
        if (error) {
            throw new Error(`Supabase read failed: ${error.message}`);
        }
        if (!data) {
            return { events: [] };
        }
        return validateStoreData(data.data);
    }
    async write(data) {
        validateStoreData(data);
        const { error } = await this.supabase.from("nodewar_store").upsert({
            key: STORE_KEY,
            data,
            updated_at: new Date().toISOString()
        });
        if (error) {
            throw new Error(`Supabase write failed: ${error.message}`);
        }
    }
}
/** Creates the Supabase-backed event store used when a URL and key are configured. */
export function createSupabaseEventStore(url, serviceRoleKey) {
    return new SupabaseEventStore(url, serviceRoleKey);
}
