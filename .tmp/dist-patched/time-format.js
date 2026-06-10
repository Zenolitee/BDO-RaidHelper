/** Formats a 24-hour clock value for dashboard and Discord display text. */
export function formatClockTime(time) {
    const [hourValue, minute = "00"] = time.split(":");
    const hour = Number.parseInt(hourValue, 10);
    if (!Number.isInteger(hour)) {
        return time;
    }
    return `${hour % 12 || 12}:${minute.padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
