import { promises as fs } from "node:fs";
import path from "node:path";
import { formatGroupName, getGroupLabel } from "./emojis.js";
const NON_ROSTER_GROUPS = new Set(["bench", "tentative", "absence"]);
/**
 * Serializes event mutations and persists roster state to a JSON file.
 *
 * Storage adapters can override {@link read} and {@link write} while reusing the
 * validation, capacity-balancing, signup, and lifecycle operations.
 */
export class EventStore {
    filePath;
    operationQueue = Promise.resolve();
    constructor(filePath) {
        this.filePath = filePath;
    }
    /** Returns all events ordered by war date and start time. */
    async listEvents() {
        return this.withStore(async (data) => [...data.events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
    }
    /** Looks up one event by its full ID. */
    async getEvent(id) {
        return this.withStore(async (data) => data.events.find((event) => event.id === id));
    }
    /** Returns persisted bot settings without exposing the mutable store object. */
    async getSettings() {
        return this.withStore(async (data) => ({ ...(data.settings ?? {}) }));
    }
    /** Saves the announcement channel selected for a Discord guild. */
    async setNodeWarChannelId(guildId, channelId) {
        return this.withStore(async (data) => {
            data.settings = {
                ...(data.settings ?? {}),
                nodeWarChannelIds: { ...(data.settings?.nodeWarChannelIds ?? {}), [guildId]: channelId }
            };
            await this.write(data);
            return { ...data.settings };
        });
    }
    /** Persists a newly created event. */
    async createEvent(event) {
        return this.withStore(async (data) => {
            event.groups = ensureResponseGroups(event.groups);
            data.events.push(event);
            await this.write(data);
            return event;
        });
    }
    /** Creates an event unless an equivalent guild, tier, day, and date record already exists. */
    async createEventIfMissing(event) {
        return this.withStore(async (data) => {
            const existing = data.events.find((candidate) => candidate.kind === event.kind &&
                candidate.guildId === event.guildId &&
                candidate.tier === event.tier &&
                candidate.day === event.day &&
                candidate.date === event.date);
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
    async setBalancedGroups(eventId, updates) {
        let updatedEvent;
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
    async updateEventDetails(eventId, updates) {
        let updatedEvent;
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
    async signup(eventId, signup) {
        let updatedEvent;
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
            const groupCount = event.signups.filter((candidate) => candidate.group === signup.group && candidate.userId !== signup.userId).length;
            const assignedGroup = isRosterGroup(targetGroup) && groupCount >= group.capacity ? "bench" : targetGroup;
            const requestedGroup = assignedGroup === "bench" ? targetGroup : undefined;
            if (existing) {
                existing.group = assignedGroup;
                existing.requestedGroup = requestedGroup;
                existing.displayName = signup.displayName;
                existing.updatedAt = now;
            }
            else {
                event.signups.push({ ...signup, group: assignedGroup, requestedGroup, createdAt: now, updatedAt: now });
            }
            updatedEvent = event;
        });
        return requireUpdated(updatedEvent);
    }
    /** Moves an existing signup between roster response groups. */
    async moveSignup(eventId, userId, targetGroup) {
        let updatedEvent;
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
            const groupCount = event.signups.filter((candidate) => candidate.group === targetGroup && candidate.userId !== userId).length;
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
    async removeSignup(eventId, userId) {
        let updatedEvent;
        await this.updateEvent(eventId, (event) => {
            event.signups = event.signups.filter((signup) => signup.userId !== userId);
            updatedEvent = event;
        });
        return requireUpdated(updatedEvent);
    }
    /** Closes an event so new Discord signups are rejected. */
    async closeEvent(eventId) {
        let updatedEvent;
        await this.updateEvent(eventId, (event) => {
            event.closed = true;
            updatedEvent = event;
        });
        return requireUpdated(updatedEvent);
    }
    /** Records the published Discord message and marks the announcement as sent. */
    async markEventAnnounced(id, message) {
        await this.updateEvent(id, (event) => {
            event.guildId = message.guildId;
            event.channelId = message.channelId;
            event.messageId = message.messageId;
            event.announcedAt = new Date().toISOString();
        });
    }
    /** Permanently removes an event from storage. */
    async deleteEvent(eventId) {
        await this.withStore(async (data) => {
            const nextEvents = data.events.filter((event) => event.id !== eventId);
            if (nextEvents.length === data.events.length) {
                throw new Error("Event not found.");
            }
            data.events = nextEvents;
            await this.write(data);
        });
    }
    async updateEvent(id, updater) {
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
    async withStore(operation) {
        const run = this.operationQueue.then(async () => operation(await this.read()));
        this.operationQueue = run.catch(() => undefined);
        return run;
    }
    /** Reads and validates the JSON store, returning an empty store when the file is absent. */
    async read() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            return validateStoreData(JSON.parse(raw));
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return { events: [], settings: {} };
            }
            throw error;
        }
    }
    /** Validates and atomically replaces the JSON store through a temporary file. */
    async write(data) {
        validateStoreData(data);
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        await fs.rename(tempPath, this.filePath);
    }
}
/** Counts members currently assigned to a roster group. */
export function groupSignupCount(event, group) {
    return event.signups.filter((signup) => signup.group === group).length;
}
/** Returns the total capacity of active roster groups. */
export function activeRosterCapacity(event) {
    return event.groups
        .filter((group) => isRosterGroup(group.key))
        .reduce((sum, group) => sum + group.capacity, 0);
}
/** Counts members assigned to capacity-bearing roster groups. */
export function activeRosterSignupCount(event) {
    return event.signups.filter((signup) => isRosterGroup(signup.group)).length;
}
/** Returns whether a group consumes one of the active roster slots. */
export function isRosterGroup(group) {
    return !NON_ROSTER_GROUPS.has(group);
}
function ensureT1CoreGroups(groups) {
    const nextGroups = groups;
    const required = [
        { key: "mainball", label: getGroupLabel("mainball"), capacity: 0, editable: true },
        { key: "defense", label: getGroupLabel("defense"), capacity: 5, editable: true },
        { key: "zerker", label: getGroupLabel("zerker"), capacity: 2, editable: true },
        { key: "shai", label: getGroupLabel("shai"), capacity: 2, editable: true },
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
function ensureResponseGroups(groups) {
    const nextGroups = [...groups];
    for (const key of ["bench", "tentative", "absence"]) {
        if (!nextGroups.some((group) => group.key === key)) {
            nextGroups.push({ key, label: getGroupLabel(key), capacity: 0, editable: false });
        }
    }
    return nextGroups;
}
function moveOverflowToBench(event) {
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
function rebalanceMainBall(groups, totalCapacity) {
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
function validateEventCapacity(event) {
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
function requireUpdated(event) {
    if (!event) {
        throw new Error("Event not found.");
    }
    return event;
}
/** Validates persisted store shape and backfills lifecycle defaults for older records. */
export function validateStoreData(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.events)) {
        throw new Error("Invalid event store JSON: expected { events: [] }.");
    }
    const data = value;
    data.settings ??= {};
    validateSettings(data.settings);
    for (const event of data.events) {
        validateEvent(event);
        event.groups = ensureResponseGroups(event.groups);
        event.active ??= !event.closed;
        event.autoRepost ??= event.recurrence === "weekly";
    }
    return data;
}
function validateSettings(settings) {
    if (!settings || typeof settings !== "object") {
        throw new Error("Invalid event store JSON: settings must be an object.");
    }
    const nodeWarChannelId = settings.nodeWarChannelId;
    if (nodeWarChannelId !== undefined && typeof nodeWarChannelId !== "string") {
        throw new Error("Invalid event store JSON: settings.nodeWarChannelId must be a string when present.");
    }
    const nodeWarChannelIds = settings.nodeWarChannelIds;
    if (nodeWarChannelIds !== undefined &&
        (!nodeWarChannelIds ||
            typeof nodeWarChannelIds !== "object" ||
            Object.entries(nodeWarChannelIds).some(([guildId, channelId]) => !guildId || typeof channelId !== "string"))) {
        throw new Error("Invalid event store JSON: settings.nodeWarChannelIds must map guild IDs to channel IDs.");
    }
}
function validateEvent(event) {
    if (!event || typeof event !== "object") {
        throw new Error("Invalid event store JSON: event must be an object.");
    }
    const requiredStrings = [
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
    const optionalStrings = [
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
    if (event.announcementRoleIds !== undefined &&
        (!Array.isArray(event.announcementRoleIds) || event.announcementRoleIds.some((roleId) => typeof roleId !== "string"))) {
        throw new Error("Invalid event store JSON: event.announcementRoleIds must be an array of strings when present.");
    }
    for (const group of event.groups) {
        if (!group ||
            typeof group.key !== "string" ||
            typeof group.label !== "string" ||
            !Number.isInteger(group.capacity) ||
            (group.emoji !== undefined && typeof group.emoji !== "string")) {
            throw new Error("Invalid event store JSON: group entries are invalid.");
        }
    }
    for (const signup of event.signups) {
        if (!signup ||
            typeof signup.userId !== "string" ||
            typeof signup.displayName !== "string" ||
            typeof signup.group !== "string" ||
            (signup.requestedGroup !== undefined && typeof signup.requestedGroup !== "string") ||
            typeof signup.createdAt !== "string" ||
            typeof signup.updatedAt !== "string") {
            throw new Error("Invalid event store JSON: signup entries are invalid.");
        }
    }
}
