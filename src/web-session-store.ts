import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface SessionRow {
  data: unknown;
  expires_at: string;
}

export interface WebSessionStore<T> {
  get(token: string): Promise<T | undefined>;
  set(token: string, value: T, expiresAt: number): Promise<void>;
  delete(token: string): Promise<void>;
}

class MemoryWebSessionStore<T> implements WebSessionStore<T> {
  private readonly sessions = new Map<string, { value: T; expiresAt: number }>();

  async get(token: string): Promise<T | undefined> {
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session.value;
  }

  async set(token: string, value: T, expiresAt: number): Promise<void> {
    this.sessions.set(token, { value, expiresAt });
  }

  async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

class SupabaseWebSessionStore<T> implements WebSessionStore<T> {
  private readonly supabase: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly validate: (value: unknown) => T | undefined
  ) {
    this.supabase = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async get(token: string): Promise<T | undefined> {
    const tokenHash = hashToken(token);
    const { data, error } = await this.supabase
      .from("web_sessions")
      .select("data,expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle<SessionRow>();

    if (error) throw new Error(`Supabase session read failed: ${error.message}`);
    if (!data) return undefined;
    if (Date.parse(data.expires_at) < Date.now()) {
      await this.delete(token);
      return undefined;
    }
    return this.validate(data.data);
  }

  async set(token: string, value: T, expiresAt: number): Promise<void> {
    const { error } = await this.supabase.from("web_sessions").upsert({
      token_hash: hashToken(token),
      data: value,
      expires_at: new Date(expiresAt).toISOString()
    });
    if (error) throw new Error(`Supabase session write failed: ${error.message}`);

    await this.supabase.from("web_sessions").delete().lt("expires_at", new Date().toISOString());
  }

  async delete(token: string): Promise<void> {
    const { error } = await this.supabase.from("web_sessions").delete().eq("token_hash", hashToken(token));
    if (error) throw new Error(`Supabase session delete failed: ${error.message}`);
  }
}

export function createWebSessionStore<T>(
  url: string | undefined,
  serviceRoleKey: string | undefined,
  validate: (value: unknown) => T | undefined
): WebSessionStore<T> {
  return url && serviceRoleKey ? new SupabaseWebSessionStore(url, serviceRoleKey, validate) : new MemoryWebSessionStore<T>();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
