import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import type { WebSession } from '../types.js';

interface EventTypeOption {
  key: string;
  title: string;
  description: string;
  image: string;
}

const EVENT_TYPES: EventTypeOption[] = [
  {
    key: "nodewar",
    title: "Node War",
    description: "Schedule a tiered Node War roster with specialist slots, signups, and automatic Discord announcements.",
    image: "/assets/nodewar.jpg"
  },
  {
    key: "gbr",
    title: "Guild Boss Raid",
    description: "Coordinate guild boss attempts with time slots, class requirements, and attendance tracking.",
    image: "/assets/gbr.png"
  },
  {
    key: "custom",
    title: "Custom Event",
    description: "Create a flexible event with custom roster groups, capacity, and scheduling for any guild activity.",
    image: "/assets/Custom.jpg"
  }
];

export function renderEventTypePickerPage(guildId: string, session: WebSession): string {
  const cards = EVENT_TYPES.map((et) => `
    <a href="/create?guild=${encodeURIComponent(guildId)}&type=${encodeURIComponent(et.key)}" class="event-type-card">
      <div class="event-type-card-image">
        <img src="${escapeHtml(et.image)}" alt="${escapeHtml(et.title)}" loading="lazy">
      </div>
      <div class="event-type-card-bottom">
        <h3 class="event-type-card-title">${escapeHtml(et.title)}</h3>
        <p class="event-type-card-desc">${escapeHtml(et.description)}</p>
      </div>
    </a>
  `).join("");

  const content = `
    <div class="event-type-page">
      <a href="/dashboard" class="event-type-back-link">Back to Dashboard</a>
      <div class="event-type-header">
        <h1 class="event-type-heading">Create Event</h1>
        <p class="event-type-sub">Choose an event type to get started.</p>
      </div>
      <div class="event-type-grid">
        ${cards}
      </div>
    </div>
  `;

  return renderApp("Create Event", content, { session, bodyClass: "event-type-page-body" });
}
