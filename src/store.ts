import { promises as fs } from "node:fs";
import path from "node:path";
import { formatGroupName, getGroupLabel } from "./emojis.js";
import type { BotSettings, EventStoreData, GroupKey, Signup, WarEvent, WizardStateData } from "./types.js";

const NON_ROSTER_GROUPS = new Set<GroupKey>(["bench", "tentative", "absence"]);

/**
 * Serializes event mutations and persists roster state to a JSON file.
 *
 * Storage adapters can override {@link read} and {@link write} while reusing the
 * validation, capacity-balancing, signup, and lifecycle operations.
 */
export class EventStore {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Returns all events ordered by war date and start time. */
  async listEvents(): Promise<WarEvent[]> {
    return this.withStore(async (data) =>
      [...data.events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    );
  }

  /** Looks up one event by its full ID. */
  async getEvent(id: string): Promise<WarEvent | undefined> {
    return this.withStore(async (data) => data.events.find((event) => event.id === id));
  }

  /** Returns persisted bot settings without exposing the mutable store object. */
  async getSettings(): Promise<BotSettings> {
    return this.withStore(async (data) => ({ ...(data.settings ?? {}) }));
  }

  /** Saves the announcement channel selected for a Discord guild. */
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

  /** Saves the approved score screenshot upload channel selected for a Discord guild. */
  async setScoreUploadChannelId(guildId: string, channelId: string): Promise<BotSettings> {
    return this.withStore(async (data) => {
      data.settings = {
        ...(data.settings ?? {}),
        scoreUploadChannelIds: { ...(data.settings?.scoreUploadChannelIds ?? {}), [guildId]: channelId }
      };
      await this.write(data);
      return { ...data.settings };
    });
  }
  /** Saves the BDO guild name linked to a Discord guild. */
  async setBdoGuildName(guildId: string, bdoGuildName: string): Promise<BotSettings> {
    return this.withStore(async (data) => {
      data.settings = {
        ...(data.settings ?? {}),
        bdoGuildNames: { ...(data.settings?.bdoGuildNames ?? {}), [guildId]: bdoGuildName }
      };
      await this.write(data);
      return { ...data.settings };
    });
  }
  /** Saves the BDO region linked to a Discord guild. */
  async setBdoGuildRegion(guildId: string, region: string): Promise<BotSettings> {
    return this.withStore(async (data) => {
      data.settings = {
        ...(data.settings ?? {}),
        bdoGuildRegions: { ...(data.settings?.bdoGuildRegions ?? {}), [guildId]: region }
      };
      await this.write(data);
      return { ...data.settings };
    });
  }



  /** Persists a newly created event. */
  async createEvent(event: WarEvent): Promise<WarEvent> {
    return this.withStore(async (data) => {
      event.groups = ensureResponseGroups(event.groups);
      data.events.push(event);
      await this.write(data);
      return event;
    });
  }

  /** Creates an event unless an equivalent guild, tier, day, and date record already exists. */
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

      event.groups = ensureResponseGroups(event.groups);
      data.events.push(event);
      await this.write(data);
      return { event, created: true };
    });
  }

  /** Updates specialist capacities and assigns the remaining roster capacity to Mainball/FFA. */
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
      event.groups = ensureResponseGroups(nextGroups);
      moveOverflowToBench(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  /** Applies lifecycle, schedule, and roster updates to an existing event. */
  async updateEventDetails(
    eventId: string,
    updates: Partial<Pick<WarEvent, "title" | "tier" | "day" | "date" | "time" | "timezone" | "recurrence" | "totalCapacity" | "groups" | "repeatDays" | "announcementDate" | "announcementTime" | "announcementChannelId" | "announcementRoleId" | "announcementRoleIds" | "announcedAt" | "closed" | "active" | "autoRepost" | "channelId" | "messageId" | "signups">>
  ): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      Object.assign(event, updates);
      if (updates.groups) {
        event.groups = ensureResponseGroups(updates.groups);
      }
      moveOverflowToBench(event);
      validateEventCapacity(event);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  /** Inserts or moves a member signup, assigning Bench when the requested group is full. */
  async signup(eventId: string, signup: Omit<Signup, "createdAt" | "updatedAt">): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;
    const now = new Date().toISOString();

    await this.updateEvent(eventId, (event) => {
      if (event.closed) {
        throw new Error("This event is closed.");
      }

      const targetGroup = signup.group;
      event.groups = ensureResponseGroups(event.groups);
      const group = event.groups.find((candidate) => candidate.key === targetGroup);
      if (!group || targetGroup === "bench") {
        throw new Error("Unknown signup group.");
      }

      const existing = event.signups.find((candidate) => candidate.userId === signup.userId);
      const groupCount = event.signups.filter(
        (candidate) => candidate.group === signup.group && candidate.userId !== signup.userId
      ).length;

      const assignedGroup = isRosterGroup(targetGroup) && groupCount >= group.capacity ? "bench" : targetGroup;
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

  /** Moves an existing signup between roster response groups. */
  async moveSignup(eventId: string, userId: string, targetGroup: GroupKey): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;
    const now = new Date().toISOString();

    await this.updateEvent(eventId, (event) => {
      event.groups = ensureResponseGroups(event.groups);
      const group = event.groups.find((candidate) => candidate.key === targetGroup);
      if (!group) {
        throw new Error("Unknown signup group.");
      }

      const signup = event.signups.find((candidate) => candidate.userId === userId);
      if (!signup) {
        throw new Error("Signup not found.");
      }

      const groupCount = event.signups.filter(
        (candidate) => candidate.group === targetGroup && candidate.userId !== userId
      ).length;
      if (isRosterGroup(targetGroup) && groupCount >= group.capacity) {
        throw new Error(`${formatGroupName(targetGroup)} is full.`);
      }

      const previousGroup = signup.requestedGroup ?? signup.group;
      signup.group = targetGroup;
      signup.requestedGroup = targetGroup === "bench" ? previousGroup : undefined;
      signup.updatedAt = now;
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  /** Removes a member from an event roster. */
  async removeSignup(eventId: string, userId: string): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      event.signups = event.signups.filter((signup) => signup.userId !== userId);
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  /** Closes an event so new Discord signups are rejected. */
  async closeEvent(eventId: string): Promise<WarEvent> {
    let updatedEvent: WarEvent | undefined;

    await this.updateEvent(eventId, (event) => {
      event.closed = true;
      updatedEvent = event;
    });

    return requireUpdated(updatedEvent);
  }

  /** Records the published Discord message and marks the announcement as sent. */
  async markEventAnnounced(id: string, message: { guildId: string; channelId: string; messageId: string }): Promise<void> {
    await this.updateEvent(id, (event) => {
      event.guildId = message.guildId;
      event.channelId = message.channelId;
      event.messageId = message.messageId;
      event.announcedAt = new Date().toISOString();
    });
  }

  /** Permanently removes an event from storage. */
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

  // ---------------------------------------------------------------------------
  // Wizard state persistence
  // ---------------------------------------------------------------------------

  /** Retrieves a persisted wizard state by user ID. */
  async getWizardState(userId: string): Promise<WizardStateData | undefined> {
    console.log(`[Store] getWizardState called for user ${userId}`);
    const result = await this.withStore(async (data) => {
      data.wizardStates ??= {};
      console.log(`[Store] wizardStates keys: ${Object.keys(data.wizardStates).join(', ') || 'none'}`);
      const state = data.wizardStates[userId];
      if (!state) return undefined;
      // Auto-expire stale states
      if (state.expiresAt < Date.now()) {
        delete data.wizardStates[userId];
        await this.write(data);
        return undefined;
      }
      return state;
    });
    console.log(`[Store] getWizardState result: ${result ? 'found' : 'not found'}`);
    return result;
  }

  /** Persists or updates a wizard state. */
  async setWizardState(userId: string, state: WizardStateData): Promise<void> {
    console.log(`[Store] setWizardState called for user ${userId}`);
    await this.withStore(async (data) => {
      data.wizardStates ??= {};
      data.wizardStates[userId] = state;
      console.log(`[Store] Writing wizard state for user ${userId}`);
      await this.write(data);
      console.log(`[Store] Wizard state written successfully`);
    });
  }

  /** Removes a persisted wizard state. */
  async deleteWizardState(userId: string): Promise<void> {
    await this.withStore(async (data) => {
      data.wizardStates ??= {};
      delete data.wizardStates[userId];
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

  /** Runs one read-modify-write operation after previously queued operations settle. */
  private async withStore<T>(operation: (data: EventStoreData) => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(async () => operation(await this.read()));
    this.operationQueue = run.catch(() => undefined);
    return run;
  }

  /** Reads and validates the JSON store, returning an empty store when the file is absent. */
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

  /** Validates and atomically replaces the JSON store through a temporary file. */
  protected async write(data: EventStoreData): Promise<void> {
    validateStoreData(data);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

/** Counts members currently assigned to a roster group. */
export function groupSignupCount(event: WarEvent, group: GroupKey): number {
  return event.signups.filter((signup) => signup.group === group).length;
}

/** Returns the total capacity of active roster groups. */
export function activeRosterCapacity(event: WarEvent): number {
  return event.groups
    .filter((group) => isRosterGroup(group.key))
    .reduce((sum, group) => sum + group.capacity, 0);
}

/** Counts members assigned to capacity-bearing roster groups. */
export function activeRosterSignupCount(event: WarEvent): number {
  return event.signups.filter((signup) => isRosterGroup(signup.group)).length;
}

/** Returns whether a group consumes one of the active roster slots. */
export function isRosterGroup(group: GroupKey): boolean {
  return !NON_ROSTER_GROUPS.has(group);
}

function ensureT1CoreGroups(groups: WarEvent["groups"]): WarEvent["groups"] {
  const nextGroups = groups;
  const required = [
    { key: "mainball", label: getGroupLabel("mainball"), capacity: 0, editable: true },
    { key: "defense", label: getGroupLabel("defense"), capacity: 5, editable: true },
    { key: "bench", label: getGroupLabel("bench"), capacity: 0, editable: false },
    { key: "tentative", label: getGroupLabel("tentative"), capacity: 0, editable: false },
    { key: "absence", label: getGroupLabel("absence"), capacity: 0, editable: false }
  ];

  for (const group of required) {
    if (!nextGroups.some((candidate) => candidate.key === group.key)) {
      nextGroups.unshift(group);
    }
  }

  return nextGroups;
}

function ensureResponseGroups(groups: WarEvent["groups"]): WarEvent["groups"] {
  const nextGroups = [...groups];
  for (const key of ["bench", "tentative", "absence"] as const) {
    if (!nextGroups.some((group) => group.key === key)) {
      nextGroups.push({ key, label: getGroupLabel(key), capacity: 0, editable: false });
    }
  }

  return nextGroups;
}

function moveOverflowToBench(event: WarEvent): void {
  event.groups = ensureResponseGroups(event.groups);
  for (const group of event.groups) {
    if (!isRosterGroup(group.key)) {
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
    .filter((group) => group.key !== "mainball" && isRosterGroup(group.key))
    .reduce((sum, group) => sum + group.capacity, 0);
  const nextMainball = totalCapacity - nonMainTotal;
  if (nextMainball < 0) {
    throw new Error(`Role slots (${nonMainTotal}) exceed total roster size (${totalCapacity}).`);
  }

  mainball.capacity = nextMainball;
}

function validateEventCapacity(event: WarEvent): void {
  const activeTotal = event.groups
    .filter((group) => isRosterGroup(group.key))
    .reduce((sum, group) => sum + group.capacity, 0);
  if (activeTotal > event.totalCapacity) {
    throw new Error(`Group slots (${activeTotal}) cannot exceed total roster size (${event.totalCapacity}).`);
  }

  for (const group of event.groups) {
    if (!isRosterGroup(group.key)) {
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

/** Validates persisted store shape and backfills lifecycle defaults for older records. */
export function validateStoreData(value: unknown): EventStoreData {
  if (!value || typeof value !== "object" || !Array.isArray((value as EventStoreData).events)) {
    throw new Error("Invalid event store JSON: expected { events: [] }.");
  }

  const data = value as EventStoreData;
  data.settings ??= {};
  validateSettings(data.settings);
  // Initialize wizardStates if not present
  data.wizardStates ??= {};
  // Clean up expired wizard states on load
  const now = Date.now();
  for (const [userId, state] of Object.entries(data.wizardStates)) {
    if (!state || typeof state !== "object" || typeof state.expiresAt !== "number" || state.expiresAt < now) {
      delete data.wizardStates[userId];
    }
  }
  for (const event of data.events) {
    validateEvent(event);
    event.groups = ensureResponseGroups(event.groups);
    event.active ??= !event.closed;
    event.autoRepost ??= event.recurrence === "weekly";
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

  const scoreUploadChannelIds = (settings as BotSettings).scoreUploadChannelIds;
  if (
    scoreUploadChannelIds !== undefined &&
    (!scoreUploadChannelIds ||
      typeof scoreUploadChannelIds !== "object" ||
      Object.entries(scoreUploadChannelIds).some(([guildId, channelId]) => !guildId || typeof channelId !== "string"))
  ) {
    throw new Error("Invalid event store JSON: settings.scoreUploadChannelIds must map guild IDs to channel IDs.");
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
  if ((event.active !== undefined && typeof event.active !== "boolean") || (event.autoRepost !== undefined && typeof event.autoRepost !== "boolean")) {
    throw new Error("Invalid event store JSON: event active or autoRepost flag is invalid.");
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
