const WEEKDAYS = new Map([
    ["sunday", 0],
    ["monday", 1],
    ["tuesday", 2],
    ["wednesday", 3],
    ["thursday", 4],
    ["friday", 5],
    ["saturday", 6]
]);
/** Parses supported date phrases, weekdays, or ISO dates into an initial schedule. */
export function parseEventDateInput(input, now = new Date()) {
    const normalized = input.trim().toLowerCase().replaceAll("-", " ");
    const today = startOfLocalDay(now);
    if (normalized === "today") {
        return { date: formatDate(today), recurrence: "once" };
    }
    if (normalized === "tomorrow") {
        return { date: formatDate(addDays(today, 1)), recurrence: "once" };
    }
    if (normalized === "everyday" || normalized === "daily" || normalized === "every day") {
        return { date: formatDate(today), recurrence: "daily" };
    }
    if (normalized === "every other day" || normalized === "alternate days") {
        return { date: formatDate(today), recurrence: "every_other_day" };
    }
    const weekday = WEEKDAYS.get(normalized);
    if (weekday !== undefined) {
        return { date: formatDate(nextWeekday(today, weekday)), recurrence: "weekly" };
    }
    const isoDate = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        const parsed = new Date(`${isoDate}T00:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
            return { date: isoDate, recurrence: "once" };
        }
    }
    throw new Error("Use today, tomorrow, everyday, every other day, a weekday, or YYYY-MM-DD.");
}
/** Returns the next local calendar date matching a Node War weekday. */
export function getNextWarDate(day, now = new Date()) {
    const weekday = WEEKDAYS.get(day);
    if (weekday === undefined) {
        throw new Error("Unknown Node War day.");
    }
    return formatDate(nextWeekday(startOfLocalDay(now), weekday));
}
function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
function nextWeekday(date, weekday) {
    const delta = (weekday - date.getDay() + 7) % 7;
    return addDays(date, delta);
}
function formatDate(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}
