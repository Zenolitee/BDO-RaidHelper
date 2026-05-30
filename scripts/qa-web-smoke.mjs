import { promises as fs } from "node:fs";
import path from "node:path";
import { eventEndsAt, refreshEventMessage, rollCompletedWeeklyEvents } from "../dist/bot.js";
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
  await expectResponse(`${baseUrl}/assets/styles.css`, 200, ".delivery-editor");
  await expectResponse(`${baseUrl}/events/${event.id}`, 200, "Zen");
  await expectResponse(`${baseUrl}/events/${event.id}`, 200, "Raid day");
  await expectResponse(`${baseUrl}/events/${event.id}/edit`, 404, "Event not found");
  await expectResponse(`${baseUrl}/create?guild=qa-guild`, 403, "Discord login required");
  const deleteResponse = await fetch(`${baseUrl}/events/${event.id}/delete`, { method: "POST" });
  if (deleteResponse.status !== 403 || !(await store.getEvent(event.id))) {
    throw new Error("Unauthenticated web request could delete an event.");
  }

  const embed = renderEventEmbed(event).toJSON();
  const mainball = embed.fields?.find((field) => field.name.includes("Mainball"));
  if (!mainball?.value.includes(`${getGroupEmoji("mainball")} \`1\` **Zen**`)) {
    throw new Error("Discord roster row did not render the selected role icon before the boxed number.");
  }

  const nodeWarEnd = eventEndsAt({ ...event, date: "2026-05-31", time: "21:00" });
  if (nodeWarEnd !== new Date("2026-05-31T22:00:00+08:00").getTime()) {
    throw new Error("Node War lifecycle must end one hour after the 9:00 PM start.");
  }

  let editedPayload;
  await refreshEventMessage(
    {
      channels: {
        fetch: async () => ({
          messages: {
            fetch: async () => ({
              edit: async (payload) => {
                editedPayload = payload;
              }
            })
          }
        })
      }
    },
    { ...event, channelId: "qa-channel", messageId: "qa-message" }
  );
  if (!editedPayload?.embeds?.[0]?.toJSON().fields?.some((field) => field.value.includes("Zen"))) {
    throw new Error("Refreshing a posted event did not edit the existing Discord message with preserved signups.");
  }

  await store.updateEventDetails(event.id, {
    announcedAt: new Date().toISOString(),
    closed: true
  });
  const rescheduled = await store.updateEventDetails(event.id, {
    date: "2026-06-01",
    announcementDate: "2026-05-31",
    announcedAt: undefined,
    closed: false
  });
  if (rescheduled.date !== "2026-06-01" || rescheduled.announcementDate !== "2026-05-31" || rescheduled.announcedAt || rescheduled.closed) {
    throw new Error("Rescheduled event did not clear the prior announcement state.");
  }

  await store.createEvent({
    ...event,
    id: "qa-weekly",
    title: "Sunday T1 Balenos/Serendia 30 Man",
    day: "sunday",
    repeatDays: ["sunday", "monday"],
    date: "2020-05-31",
    recurrence: "weekly",
    autoRepost: true,
    signups: event.signups.map((signup) => ({ ...signup }))
  });
  await expectResponse(`${baseUrl}/events/qa-weekly`, 200, "Fresh roster");
  await expectResponse(`${baseUrl}/events/qa-weekly`, 200, "T1 Balenos/Serendia War [qa-weekly]");
  await expectResponse(`${baseUrl}/events/qa-weekly`, 200, "Current live roster");
  await expectResponse(`${baseUrl}/events/qa-weekly`, 200, "Future signup announcement queue");
  await rollCompletedWeeklyEvents(
    { channels: { fetch: async () => undefined } },
    store,
    { date: "2026-05-31", hour: 23, minute: 0, weekday: "sunday" }
  );
  const weeklyEvents = await store.listEvents();
  const monday = weeklyEvents.find((candidate) => candidate.id === "qa-weekly");
  const duplicateMonday = weeklyEvents.find((candidate) => candidate.id !== "qa-weekly" && candidate.day === "monday" && candidate.date === "2026-06-01");
  if (!monday || monday.title !== "Monday T1 Balenos/Serendia 25 Man" || monday.signups.length !== 0 || monday.recurrence !== "weekly" || monday.closed) {
    throw new Error("Weekly rollover did not rotate the same raid card into a fresh day-specific Monday roster.");
  }
  if (duplicateMonday) {
    throw new Error("Weekly rollover created a duplicate raid card.");
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
