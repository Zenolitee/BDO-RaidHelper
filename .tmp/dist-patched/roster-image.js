import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { getGroupLabel } from "./emojis.js";
import { NODE_WAR_PRESETS } from "./nodewar-presets.js";
const WIDTH = 1200;
const HEIGHT = 900;
const ASSET_DIR = path.resolve("images");
const GROUP_ORDER = ["mainball", "defense", "zerker", "shai"];
const ICONS = {
    defense: "Warrior_icon.png",
    zerker: "Berserker_icon.png",
    shai: "shai.png"
};
export async function renderRosterImage(event) {
    const icons = await loadIcons();
    const svg = renderRosterSvg(event, icons);
    return sharp(Buffer.from(svg)).png().toBuffer();
}
async function loadIcons() {
    const entries = await Promise.all(Object.entries(ICONS).map(async ([key, file]) => {
        try {
            if (!file) {
                return [key, undefined];
            }
            const buffer = await fs.readFile(path.join(ASSET_DIR, file));
            return [key, `data:image/png;base64,${buffer.toString("base64")}`];
        }
        catch {
            return [key, undefined];
        }
    }));
    return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
}
function renderRosterSvg(event, icons) {
    const signed = event.signups.filter((signup) => signup.group !== "bench").length;
    const territory = event.tier ? NODE_WAR_PRESETS[event.tier].territoryGroup : "Node War";
    const summary = [
        territory,
        formatDate(event.date, event.timezone),
        formatTime(event.time),
        `${signed}/${event.totalCapacity} signed`
    ];
    const groupCards = GROUP_ORDER.map((group, index) => renderGroupCard(event, group, 48 + index * 276, 238, icons[group])).join("");
    const bench = renderBench(event);
    return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15171f"/>
      <stop offset="1" stop-color="#20242f"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <rect x="28" y="28" width="1144" height="844" rx="28" fill="#232733" stroke="#3a4050"/>
  <text x="56" y="88" fill="#f5f7fb" font-family="Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(event.title)}</text>
  <text x="56" y="128" fill="#aeb6c6" font-family="Arial, sans-serif" font-size="20">ID ${escapeXml(event.id)}</text>
  ${summary.map((item, index) => summaryPill(item, 56 + index * 266, 158)).join("")}
  ${compositionRow(event)}
  ${groupCards}
  ${bench}
  <text x="56" y="842" fill="#697386" font-family="Arial, sans-serif" font-size="18">NW Helper | Event ${escapeXml(event.id)}</text>
</svg>`;
}
function summaryPill(label, x, y) {
    return `<rect x="${x}" y="${y}" width="246" height="46" rx="14" fill="#151923" stroke="#343a49"/>
  <text x="${x + 18}" y="${y + 30}" fill="#dbe1ea" font-family="Arial, sans-serif" font-size="18">${escapeXml(label)}</text>`;
}
function compositionRow(event) {
    const items = GROUP_ORDER.map((key) => {
        const group = event.groups.find((candidate) => candidate.key === key);
        const count = event.signups.filter((signup) => signup.group === key).length;
        return `${getGroupLabel(key)} ${count}/${group?.capacity ?? 0}`;
    }).join("   |   ");
    return `<text x="56" y="226" fill="#f2b84b" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(items)}</text>`;
}
function renderGroupCard(event, key, x, y, icon) {
    const group = event.groups.find((candidate) => candidate.key === key);
    const count = event.signups.filter((signup) => signup.group === key).length;
    const capacity = group?.capacity ?? 0;
    const signups = event.signups.filter((signup) => signup.group === key).slice(0, 12);
    const names = signups.length
        ? signups.map((signup, index) => rosterLine(index + 1, signup.displayName, x + 24, y + 112 + index * 31)).join("")
        : `<text x="${x + 24}" y="${y + 116}" fill="#8791a3" font-family="Arial, sans-serif" font-size="19">No signups yet.</text>`;
    const iconMarkup = icon
        ? `<image href="${icon}" x="${x + 22}" y="${y + 22}" width="38" height="38" preserveAspectRatio="xMidYMid meet"/>`
        : `<text x="${x + 25}" y="${y + 54}" fill="#f2b84b" font-family="Arial, sans-serif" font-size="31">⚔</text>`;
    return `<g filter="url(#shadow)">
    <rect x="${x}" y="${y}" width="252" height="470" rx="18" fill="#171b25" stroke="#353c4b"/>
    ${iconMarkup}
    <text x="${x + 70}" y="${y + 48}" fill="#f5f7fb" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(getGroupLabel(key))}</text>
    <text x="${x + 24}" y="${y + 84}" fill="#aeb6c6" font-family="Arial, sans-serif" font-size="18">${count}/${capacity}</text>
    ${names}
  </g>`;
}
function renderBench(event) {
    const signups = event.signups.filter((signup) => signup.group === "bench").slice(0, 14);
    const content = signups.length
        ? signups.map((signup, index) => {
            const x = 70 + (index % 7) * 154;
            const y = 780 + Math.floor(index / 7) * 30;
            return `<text x="${x}" y="${y}" fill="#dbe1ea" font-family="Arial, sans-serif" font-size="18">${index + 1}. ${escapeXml(truncate(signup.displayName, 16))}</text>`;
        }).join("")
        : `<text x="70" y="782" fill="#8791a3" font-family="Arial, sans-serif" font-size="18">No signups yet.</text>`;
    return `<rect x="48" y="724" width="1104" height="96" rx="18" fill="#171b25" stroke="#353c4b"/>
  <text x="70" y="758" fill="#f5f7fb" font-family="Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(getGroupLabel("bench"))}</text>
  ${content}`;
}
function rosterLine(index, name, x, y) {
    return `<text x="${x}" y="${y}" fill="#dbe1ea" font-family="Arial, sans-serif" font-size="19">${index}. ${escapeXml(truncate(name, 22))}</text>`;
}
function truncate(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
function formatDate(date, timezone) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
        return date;
    }
    return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone === "server time" ? config.timezone : timezone,
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(parsed);
}
function formatTime(time) {
    const [hourValue, minute = "00"] = time.split(":");
    const hour = Number.parseInt(hourValue, 10);
    if (!Number.isInteger(hour)) {
        return time;
    }
    const suffix = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minute.padStart(2, "0")} ${suffix}`;
}
function escapeXml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
