import { promises as fs } from "node:fs";
import path from "node:path";
import { formatGroupBadge, formatGroupName, getGroupLabel } from "./emojis.js";
import type { BotSettings, EventStoreData, GroupKey, Signup, WarEvent } from "./types.js";

export class EventStore {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async listEvents(): Promise<WarEvent[]> {
    return this.withStore(async (data) =>
      [...data.events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    );
  }

  async getEvent(id: string): Promise<WarEvent | undefined> {
    return this.withStore(async (data) => data.events.find((event) => event.id === id));
  }

  async getSettings(): Promise<BotSettings> {
    return this.withStore(async (data) => ({ ...(data.settings ?? {}) }));
  }

  async setNodeWarChannelId(guildId: string, channelId: string): Promise<BotSettings> {
    return this.withStore(async (data) => {
      data.settings = {
        ...(data.settings ?? {}),
        nodeWarChannelIds: { ...(data.settings?.nodeWarChannelIds ?? {}), [guildId]: channelId }
      };
      await this.write(data);
      return { ...data.settings };
    });
  }

  async createEvent(event: WarEvent): Promise<WarEvent> {
    return this.withStore(async (data) => {
      data.events.push(event);
      await this.write(data);
      return event;
    });
  }

  async createEventIfMissing(event: WarEvent): Promise<{ event: WarEvent; created: boolean }> {
    return this.withStore(async (data) => {
      const existing = data.events.find(
        (candidate) =>
          candidate.kind === event.kind &&
          candidate.guildId === event.guildId &&
          candidate.tier === event.tier &&
          candidate.day === event.day &&
          candidate.date === event.date
      );
      if (existing) {
        return { event: existing, created: false };
      }

      data.events.push(event);
      await this.write(data);
      return { event, created: true };
    });
  }

  async updateEventMessage(id: string, message: { guildId: string; channelId: string; messageId: string }): Promise<void> {
    await this.updateEvent(id, (event) => {
      event.guildId = message.guildId;
      event.channelId = message.channelId;
      event.messageId = message.messageId;
    });
  }

  async allocateGroups(eventId: string, groups: WarEvent["groups"]): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      const total = groups.filter((group) => group.key !== "bench").reduce((sum, group) => sum + group.capacity, 0);
      if (total > event.totalCapacity) {
        throw new Error(`Group slots (${total}) cannot exceed total roster size (${event.totalCapacity}).`);
      }

      event.groups = ensureBenchGroup(groups);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async setBalancedGroups(eventId: string, updates: Record<string, number>): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      const nextGroups = ensureT1CoreGroups(event.groups.map((group) => ({ ...group })));
      for (const [key, capacity] of Object.entries(updates)) {
        const group = nextGroups.find((candidate) => candidate.key === key);
        if (!group) {
          throw new Error(`${key} is not enabled for this event.`);
        }

        group.capacity = capacity;
      }

      rebalanceMainBall(nextGroups, event.totalCapacity);
      event.groups = ensureBenchGroup(nextGroups);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async updateEventDetails(
    eventId: string,
    updates: Partial<Pick<WarEvent, "title" | "tier" | "day" | "date" | "time" | "timezone" | "recurrence" | "totalCapacity" | "groups" | "repeatDays" | "announcementDate" | "announcementTime" | "announcementChannelId" | "announcementRoleId" | "announcementRoleIds" | "announcedAt" | "closed">>
  ): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      Object.assign(event, updates);
      if (updates.groups) {
        event.groups = ensureBenchGroup(updates.groups);
      }
      moveOverflowToBench(event);
      validateEventCapacity(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async setGroupCapacity(eventId: string, groupKey: GroupKey, capacity: number): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      const group = event.groups.find((candidate) => candidate.key === groupKey);
      if (!group) {
        throw new Error("Group not found.");
      }

      if (groupKey === "mainball") {
        throw new Error(`${formatGroupName("mainball")} is calculated from ${formatGroupBadge("defense")}, ${formatGroupBadge("zerker")}, and ${formatGroupBadge("shai")}.`);
      }

      group.capacity = capacity;
      rebalanceMainBall(event.groups, event.totalCapacity);
      event.groups = ensureBenchGroup(event.groups);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async upsertGroup(eventId: string, group: WarEvent["groups"][number]): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      const existing = event.groups.find((candidate) => candidate.key === group.key);
      if (existing) {
        existing.label = group.label;
        existing.capacity = group.capacity;
        existing.editable = true;
        existing.emoji = group.emoji;
      } else {
        event.groups.push({ ...group, editable: true });
      }

      rebalanceMainBall(event.groups, event.totalCapacity);
      event.groups = ensureBenchGroup(event.groups);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async setEnabledRoles(eventId: string, enabledGroups: WarEvent["groups"]): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      for (const group of event.groups) {
        const stillEnabled = enabledGroups.some((candidate) => candidate.key === group.key);
        const hasSignups = event.signups.some((signup) => signup.group === group.key);
        if (!stillEnabled && hasSignups) {
          throw new Error(`Cannot remove ${group.label}; it has signups.`);
        }
      }

      event.groups = ensureBenchGroup(enabledGroups.map((group) => ({ ...group, editable: group.key !== "bench" })));
      rebalanceMainBall(event.groups, event.totalCapacity);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async signup(eventId: string, signup: Omit<Signup, "createdAt" | "updatedAt">): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;
    const now = new Date().toISOString();

    await this.updateEvent(eventId, (event) => {
      if (event.closed) {
        throw new Error("This event is closed.");
      }

      const targetGroup = signup.group;
      const group = event.groups.find((candidate) => candidate.key === targetGroup);
      if (!group || targetGroup === "bench") {
        throw new Error("Unknown signup group.");
      }

      const existing = event.signups.find((candidate) => candidate.userId === signup.userId);
      const groupCount = event.signups.filter(
        (candidate) => candidate.group === signup.group && candidate.userId !== signup.userId
      ).length;

      event.groups = ensureBenchGroup(event.groups);
      const assignedGroup = groupCount >= group.capacity ? "bench" : targetGroup;
      const requestedGroup = assignedGroup === "bench" ? targetGroup : undefined;

      if (existing) {
        existing.group = assignedGroup;
        existing.requestedGroup = requestedGroup;
        existing.displayName = signup.displayName;
        existing.updatedAt = now;
      } else {
        event.signups.push({ ...signup, group: assignedGroup, requestedGroup, createdAt: now, updatedAt: now });
      }

      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async removeSignup(eventId: string, userId: string): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      event.signups = event.signups.filter((signup) => signup.userId !== userId);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async closeEvent(eventId: string): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      event.closed = true;
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async markEventAnnounced(id: string, message: { guildId: string; channelId: string; messageId: string }): Promise<void> {
    await this.updateEvent(id, (event) => {
      event.guildId = message.guildId;
      event.channelId = message.channelId;
      event.messageId = message.messageId;
      event.announcedAt = new Date().toISOString();
    });
  }

  async setEventTime(eventId: string, time: string): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      event.time = time;
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.withStore(async (data) => {
      const nextEvents = data.events.filter((event) => event.id !== eventId);
      if (nextEvents.length === data.events.length) {
        throw new Error("Event not found.");
      }

      data.events = nextEvents;
      await this.write(data);
    });
  }

  private async updateEvent(id: string, updater: (event: WarEvent) => void): Promise<void> {
    await this.withStore(async (data) => {
      const event = data.events.find((candidate) => candidate.id === id);

      if (!event) {
        throw new Error("Event not found.");
      }

      updater(event);
      await this.write(data);
    });
  }

  private async withStore<T>(operation: (data: EventStoreData) => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(async () => operation(await this.read()));
    this.operationQueue = run.catch(() => undefined);
    return run;
  }

  protected async read(): Promise<EventStoreData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return validateStoreData(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { events: [], settings: {} };
      }
      throw error;
    }
  }

  protected async write(data: EventStoreData): Promise<void> {
    validateStoreData(data);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

export function groupSignupCount(event: WarEvent, group: GroupKey): number {
  return event.signups.filter((signup) => signup.group === group).length;
}

export function activeRosterCapacity(event: WarEvent): number {
  return event.groups
    .filter((group) => group.key !== "bench")
    .reduce((sum, group) => sum + group.capacity, 0);
}

function ensureT1CoreGroups(groups: WarEvent["groups"]): WarEvent["groups"] {
  const nextGroups = groups;
  const required = [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: 0, editable: true },
    { key: "defense", label: getGroupLabel("defense"), capacity: 5, editable: true },
    { key: "zerker", label: getGroupLabel("zerker"), capacity: 2, editable: true },
    { key: "shai", label: getGroupLabel("shai"), capacity: 2, editable: true },
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }
  ];

  for (const group of required) {
    if (!nextGroups.some((candidate) => candidate.key === group.key)) {
      nextGroups.unshift(group);
    }
  }

  return nextGroups;
}

function ensureBenchGroup(groups: WarEvent["groups"]): WarEvent["groups"] {
  if (groups.some((group) => group.key === "bench")) {
    return groups;
  }

  return [...groups, { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false }];
}

function moveOverflowToBench(event: WarEvent): void {
  event.groups = ensureBenchGroup(event.groups);
  for (const group of event.groups) {
    if (group.key === "bench") {
      continue;
    }

    const signups = event.signups.filter((signup) => signup.group === group.key);
    for (const signup of signups.slice(group.capacity)) {
      signup.group = "bench";
      signup.requestedGroup = group.key;
      signup.updatedAt = new Date().toISOString();
    }
  }
}

function rebalanceMainBall(groups: WarEvent["groups"], totalCapacity: number): void {
  const mainball = groups.find((group) => group.key === "mainball");
  if (!mainball) {
    throw new Error(`${formatGroupName("mainball")} role is required.`);
  }

  const nonMainTotal = groups
    .filter((group) => group.key !== "mainball" && group.key !== "bench")
    .reduce((sum, group) => sum + group.capacity, 0);
  const nextMainball = totalCapacity - nonMainTotal;
  if (nextMainball < 0) {
    throw new Error(`Role slots (${nonMainTotal}) exceed total roster size (${totalCapacity}).`);
  }

  mainball.capacity = nextMainball;
}

function validateEventCapacity(event: WarEvent): void {
  const activeTotal = event.groups
    .filter((group) => group.key !== "bench")
    .reduce((sum, group) => sum + group.capacity, 0);
  if (activeTotal > event.totalCapacity) {
    throw new Error(`Group slots (${activeTotal}) cannot exceed total roster size (${event.totalCapacity}).`);
  }

  for (const group of event.groups) {
    if (group.key === "bench") {
      continue;
    }

    const signed = event.signups.filter((signup) => signup.group === group.key).length;
    if (group.capacity < signed) {
      throw new Error(`${group.label} already has ${signed} signups.`);
    }
  }
}

function requireUpdated(event: WarEvent | undefined): WarEvent {
  if (!event) {
    throw new Error("Event not found.");
  }
  return event;
}

export function validateStoreData(value: unknown): EventStoreData {
  if (!value || typeof value !== "object" || !Array.isArray((value as EventStoreData).events)) {
    throw new Error("Invalid event store JSON: expected { events: [] }.");
  }

  const data = value as EventStoreData;
  data.settings ??= {};
  validateSettings(data.settings);
  for (const event of data.events) {
    validateEvent(event);
  }
  return data;
}

function validateSettings(settings: unknown): void {
  if (!settings || typeof settings !== "object") {
    throw new Error("Invalid event store JSON: settings must be an object.");
  }

  const nodeWarChannelId = (settings as BotSettings).nodeWarChannelId;
  if (nodeWarChannelId !== undefined && typeof nodeWarChannelId !== "string") {
    throw new Error("Invalid event store JSON: settings.nodeWarChannelId must be a string when present.");
  }
  const nodeWarChannelIds = (settings as BotSettings).nodeWarChannelIds;
  if (
    nodeWarChannelIds !== undefined &&
    (!nodeWarChannelIds ||
      typeof nodeWarChannelIds !== "object" ||
      Object.entries(nodeWarChannelIds).some(([guildId, channelId]) => !guildId || typeof channelId !== "string"))
  ) {
    throw new Error("Invalid event store JSON: settings.nodeWarChannelIds must map guild IDs to channel IDs.");
  }
}

function validateEvent(event: WarEvent): void {
  if (!event || typeof event !== "object") {
    throw new Error("Invalid event store JSON: event must be an object.");
  }

  const requiredStrings: Array<keyof WarEvent> = [
    "id",
    "title",
    "kind",
    "date",
    "time",
    "timezone",
    "recurrence",
    "createdBy",
    "createdAt"
  ];
  for (const key of requiredStrings) {
    if (typeof event[key] !== "string") {
      throw new Error(`Invalid event store JSON: event.${String(key)} must be a string.`);
    }
  }

  if (!Number.isInteger(event.totalCapacity) || event.totalCapacity < 0) {
    throw new Error("Invalid event store JSON: event.totalCapacity must be a non-negative integer.");
  }

  if (!Array.isArray(event.groups) || !Array.isArray(event.signups) || typeof event.closed !== "boolean") {
    throw new Error("Invalid event store JSON: event groups, signups, or closed flag are invalid.");
  }

  const optionalStrings: Array<keyof WarEvent> = [
    "announcementDate",
    "announcementTime",
    "announcementChannelId",
    "announcementRoleId",
    "announcedAt"
  ];
  for (const key of optionalStrings) {
    if (event[key] !== undefined && typeof event[key] !== "string") {
      throw new Error(`Invalid event store JSON: event.${String(key)} must be a string when present.`);
    }
  }
  if (
    event.announcementRoleIds !== undefined &&
    (!Array.isArray(event.announcementRoleIds) || event.announcementRoleIds.some((roleId) => typeof roleId !== "string"))
  ) {
    throw new Error("Invalid event store JSON: event.announcementRoleIds must be an array of strings when present.");
  }

  for (const group of event.groups) {
    if (
      !group ||
      typeof group.key !== "string" ||
      typeof group.label !== "string" ||
      !Number.isInteger(group.capacity) ||
      (group.emoji !== undefined && typeof group.emoji !== "string")
    ) {
      throw new Error("Invalid event store JSON: group entries are invalid.");
    }
  }

  for (const signup of event.signups) {
    if (
      !signup ||
      typeof signup.userId !== "string" ||
      typeof signup.displayName !== "string" ||
      typeof signup.group !== "string" ||
      (signup.requestedGroup !== undefined && typeof signup.requestedGroup !== "string") ||
      typeof signup.createdAt !== "string" ||
      typeof signup.updatedAt !== "string"
    ) {
      throw new Error("Invalid event store JSON: signup entries are invalid.");
    }
  }
}
