import { config } from "./config.js";
import { createDiscordClient, refreshEventMessage } from "./bot.js";
import { EventStore } from "./store.js";
import { createScoreStore } from "./score-store.js";
import { createSupabaseEventStore } from "./supabase-store.js";
import { createWebApp } from "./web.js";

const store =
  config.supabaseUrl && config.supabaseKey
    ? createSupabaseEventStore(config.supabaseUrl, config.supabaseKey)
    : new EventStore(config.dataFile);

console.log(
  config.supabaseUrl && config.supabaseKey
    ? "Using Supabase event storage."
    : `Using JSON event storage at ${config.dataFile}.`
);
const client = config.discordToken ? createDiscordClient(store) : undefined;
const scoreStore = createScoreStore({
  supabaseUrl: config.supabaseUrl,
  supabaseServiceRoleKey: config.supabaseServiceRoleKey,
  dataFile: config.dataFile
});
const app = createWebApp(store, {
  onEventUpdated: client ? (event) => refreshEventMessage(client, event) : undefined,
  scoreStore
});

app.listen(config.port, () => {
  console.log(`Web roster running at ${config.publicBaseUrl}`);
});

if (client && config.discordToken) {
  await client.login(config.discordToken);
} else {
  console.warn("DISCORD_TOKEN is not set. Web server is running without the Discord bot.");
}
