import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { readDiscordConfig } from "./config.js";

const { token, clientId, guildId } = readDiscordConfig();
const rest = new REST({ version: "10" }).setToken(token);

const registerGlobal = process.env.REGISTER_COMMANDS_GLOBAL === "true";
const guildIds = (process.env.DISCORD_GUILD_IDS ?? guildId)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (registerGlobal) {
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Registered ${commands.length} command group globally. Global commands can take up to 1 hour to appear.`);
  for (const targetGuildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, targetGuildId), { body: [] });
    console.log(`Cleared guild-scoped commands for guild ${targetGuildId}; global commands remain available.`);
  }
} else {
  for (const targetGuildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, targetGuildId), { body: commands });
    console.log(`Registered ${commands.length} command group for guild ${targetGuildId}.`);
  }
}
