import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EventStore, validateStoreData } from "./store.js";
import type { EventStoreData } from "./types.js";

const STORE_KEY = "default";

interface StoreRow {
  key: string;
  data: unknown;
}

export class SupabaseEventStore extends EventStore {
  private readonly supabase: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    super("__supabase__");
    this.supabase = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  protected override async read(): Promise<EventStoreData> {
    const { data, error } = await this.supabase
      .from("nodewar_store")
      .select("key,data")
      .eq("key", STORE_KEY)
      .maybeSingle<StoreRow>();

    if (error) {
      throw new Error(`Supabase read failed: ${error.message}`);
    }

    if (!data) {
      return { events: [] };
    }

    return validateStoreData(data.data);
  }

  protected override async write(data: EventStoreData): Promise<void> {
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

export function createSupabaseEventStore(url: string, serviceRoleKey: string): SupabaseEventStore {
  return new SupabaseEventStore(url, serviceRoleKey);
}
