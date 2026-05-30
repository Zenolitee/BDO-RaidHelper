import { promises as fs } from "node:fs";
import path from "node:path";
import { getGroupEmoji } from "../dist/emojis.js";
import { renderEventEmbed } from "../dist/render.js";
import { EventStore } from "../dist/store.js";
import { createWebApp } from "../dist/web.js";

const tempDir = path.resolve(".tmp");
const tempFile = path.join(tempDir, "qa-web-events.json");
const event = {
  id: "qa-event",
  title: "Sunday T1 Balenos/Serendia 30 Man",
  kind: "nodewar",
  tier: "tier1",
  day: "sunday",
  repeatDays: ["sunday"],
  date: "2026-05-31",
  time: "21:00",
  timezone: "Asia/Singapore",
  recurrence: "once",
  totalCapacity: 30,
  groups: [
    { key: "mainball", label: "Mainball/FFA", capacity: 21 },
    { key: "defense", label: "Defense", capacity: 5 },
    { key: "zerker", label: "Zerker", capacity: 2 },
    { key: "shai", label: "Shai", capacity: 2 },
    { key: "bench", label: "Benched", capacity: 0 }
  ],
  guildId: "qa-guild",
  createdBy: "qa",
  createdAt: new Date().toISOString(),
  signups: [
    {
      userId: "qa-user",
      displayName: "Zen",
      group: "mainball",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  closed: false
};

await fs.mkdir(tempDir, { recursive: true });
await fs.rm(tempFile, { force: true });
const store = new EventStore(tempFile);
await store.createEvent(event);
const server = createWebApp(store).listen(0);
await new Promise((resolve) => server.once("listening", resolve));

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("QA server did not bind to a TCP port.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  await expectResponse(`${baseUrl}/`, 200, "Log in with Discord");
  await expectResponse(`${baseUrl}/events/${event.id}`, 200, "Zen");
  await expectResponse(`${baseUrl}/events/${event.id}`, 200, "Raid day");
  await expectResponse(`${baseUrl}/events/${event.id}/edit`, 404, "Event not found");
  await expectResponse(`${baseUrl}/create?guild=qa-guild`, 403, "Discord login required");

  const embed = renderEventEmbed(event).toJSON();
  const mainball = embed.fields?.find((field) => field.name.includes("Mainball"));
  if (!mainball?.value.includes(`${getGroupEmoji("mainball")} \`1\` **Zen**`)) {
    throw new Error("Discord roster row did not render the selected role icon before the boxed number.");
  }
  console.log("Web smoke QA passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await fs.rm(tempFile, { force: true });
}

async function expectResponse(url, status, expectedText) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== status || !body.includes(expectedText)) {
    throw new Error(`${url} returned ${response.status}; expected ${status} with ${JSON.stringify(expectedText)}.`);
  }
}
