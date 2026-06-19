import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import { config } from '../../config.js';
import { GBR_BOSSES, DEFAULT_BOSS_ORDER } from '../../gbr.js';
import { TIMEZONE_OPTIONS } from '../../timezone.js';
import type { WebSession, GuildDeliveryOptions } from '../types.js';

export function renderCreateGBRPage(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const bossesJson = JSON.stringify(GBR_BOSSES);
  const defaultOrderJson = JSON.stringify(DEFAULT_BOSS_ORDER);

  const bossCards = DEFAULT_BOSS_ORDER.map((key, i) => {
    const boss = GBR_BOSSES.find((b) => b.key === key)!;
    return `
      <div class="gbr-boss-card" data-boss-key="${escapeHtml(boss.key)}" draggable="true">
        <span class="gbr-boss-num">${i + 1}</span>
        <img src="${escapeHtml(boss.image)}" alt="${escapeHtml(boss.name)}" class="gbr-boss-img" />
        <span class="gbr-boss-name">${escapeHtml(boss.name)}</span>
        <span class="gbr-boss-drag">⠿</span>
      </div>`;
  }).join("");

  const dayButtons = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    .map((d) => `<span class="gbr-day-btn" data-day="${d}">${d.slice(0, 3).toUpperCase()}</span>`)
    .join("");

  const content = `
    <div class="gbr-shell">
      <div class="gbr-topbar">
        <h1>Create Guild Boss Raid</h1>
        <a href="/create?guild=${escapeHtml(guildId)}" class="button button-ghost button-sm">← Back</a>
      </div>
      <div class="gbr-create-page">
        <form id="gbr-form" method="POST" action="/create">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <input type="hidden" name="guildId" value="${escapeHtml(guildId)}" />
          <input type="hidden" name="type" value="gbr" />
          <input type="hidden" name="bossOrder" id="boss-order-value" value="${escapeHtml(DEFAULT_BOSS_ORDER.join(","))}" />
          <input type="hidden" name="repeatDays" id="repeat-days-value" value="" />

        <div class="gbr-grid">
          <!-- Panel 01: Schedule -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">01</span> Schedule</div>
            <div class="gbr-panel-body">
              <label class="gbr-label">Repeat</label>
              <select name="recurrence" class="gbr-input">
                <option value="weekly">Weekly</option>
                <option value="once">Once</option>
              </select>

              <label class="gbr-label">Announce At</label>
              <input type="time" name="announcementTime" value="22:15" class="gbr-input" />

              <label class="gbr-label">Boss Time</label>
              <input type="time" name="bossTime" value="21:00" class="gbr-input" />

              <label class="gbr-label">Timezone</label>
              <select name="timezone" class="gbr-input">
                ${TIMEZONE_OPTIONS.map((tz) => `<option value="${escapeHtml(tz.value)}">${escapeHtml(tz.label)}</option>`).join("")}
              </select>

              <label class="gbr-label">Pick a day for GBR</label>
              <div class="gbr-days">${dayButtons}</div>
            </div>
          </div>

          <!-- Panel 02: Boss Order -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">02</span> Boss Order</div>
            <div class="gbr-panel-body">
              <div class="gbr-boss-list" id="boss-list">
                ${bossCards}
              </div>
            </div>
          </div>

          <!-- Panel 03: Delivery -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">03</span> Delivery</div>
            <div class="gbr-panel-body">
              <label class="gbr-label">Channel</label>
              <select name="announcementChannelId" class="gbr-input" required>
                <option value="">Select a Discord channel</option>
                ${deliveryOptions.channels
                  .map((ch) => `<option value="${escapeHtml(ch.id)}"${ch.id === configuredChannelId ? " selected" : ""}># ${escapeHtml(ch.name)}</option>`)
                  .join("")}
              </select>

              <label class="gbr-label">Ping Role</label>
              <select name="announcementRoleIds" class="gbr-input">
                <option value="">None</option>
                ${deliveryOptions.roles
                  .map((role) => `<option value="${escapeHtml(role.id)}"${role.id === config.nodeWarRoleId ? " selected" : ""}>@${escapeHtml(role.name)}</option>`)
                  .join("")}
              </select>
            </div>
          </div>

          <!-- Panel 04: Live Preview -->
          <div class="gbr-panel gbr-panel-preview">
            <div class="gbr-panel-head">Live Preview</div>
            <div class="gbr-panel-body gbr-preview-body">
              <div class="discord-message">
                <div class="discord-avatar"><img class="discord-avatar-img" src="/assets/project_athena.png" alt="Athena" /></div>
                <div class="discord-message-content">
                  <div class="discord-message-header">
                    <span class="discord-message-author">Athena</span>
                    <span class="discord-message-bot-tag">BOT</span>
                    <span class="discord-message-timestamp">Today at <span id="preview-announce-time">10:15 PM</span></span>
                  </div>
                  <div class="discord-embed">
                    <div class="discord-embed-color-bar"></div>
                    <div class="discord-embed-body">
                      <div class="discord-embed-title" id="preview-title">Guild Boss Raid - Monday</div>
                      <div class="discord-embed-fields">
                        <div class="discord-embed-field">
                          <div class="discord-embed-field-name">📅 Date</div>
                          <div class="discord-embed-field-value" id="preview-date">June 23, 2026</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-embed-field-name">🕐 Time</div>
                          <div class="discord-embed-field-value" id="preview-time">9:00 PM</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-embed-field-name">📢 Announce</div>
                          <div class="discord-embed-field-value" id="preview-announce">10:15 PM</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-embed-field-name">📊 Status</div>
                          <div class="discord-embed-field-value">Open</div>
                        </div>
                      </div>
                      <div class="discord-embed-divider"></div>
                      <div class="discord-embed-field-name" style="margin-bottom:6px;">🐉 BOSS ORDER</div>
                      <div class="discord-embed-field-value" id="preview-boss-initials" style="font-weight:600;margin-bottom:4px;font-family:monospace;">O → MU → F → MO → K</div>
                      <div class="discord-embed-field-value" id="preview-boss-names" style="color:#949ba4;font-size:0.8rem;">Org → Mudster → Ferrid → Moghulis → Khan</div>
                      <div class="discord-embed-divider"></div>
                      <div class="discord-embed-field-value" id="preview-countdown" style="color:#949ba4;">⏱️ <strong>Starting in 2 hours</strong></div>
                    </div>
                  </div>
                  <div class="discord-embed-footer">Project Athena | Event GBR-001</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="gbr-actions">
          <button type="submit" class="button button-primary">Create GBR Event</button>
        </div>
      </form>
      </div>
    </div>
  `;

  return renderApp("Create GBR", content, { session, bodyClass: "gbr-create-body", headExtra: '<link rel="stylesheet" href="/assets/css/gbr.css">' })
    + renderGBRScript();
}

function renderGBRScript(): string {
  return `<script>
    (function() {
      const bossList = document.getElementById('boss-list');
      const orderInput = document.getElementById('boss-order-value');
      const dayBtns = document.querySelectorAll('.gbr-day-btn');
      const repeatDaysInput = document.getElementById('repeat-days-value');
      const previewInitials = document.getElementById('preview-boss-initials');
      const previewNames = document.getElementById('preview-boss-names');
      const previewTitle = document.getElementById('preview-title');
      const previewDate = document.getElementById('preview-date');
      const previewTime = document.getElementById('preview-time');
      const previewAnnounce = document.getElementById('preview-announce');
      const previewAnnounceTime = document.getElementById('preview-announce-time');
      const previewCountdown = document.getElementById('preview-countdown');

      const BOSS_MAP = ${JSON.stringify(Object.fromEntries(GBR_BOSSES.map(b => [b.key, b])))};
      const BOSS_ORDER = ${JSON.stringify(DEFAULT_BOSS_ORDER)};

      let selectedDay = '';

      // Day button selection
      dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const recurrence = document.querySelector('[name="recurrence"]').value;
          if (recurrence === 'once') {
            dayBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDay = btn.dataset.day;
          } else {
            btn.classList.toggle('active');
            const active = document.querySelectorAll('.gbr-day-btn.active');
            selectedDay = active.length > 0 ? active[0].dataset.day : '';
          }
          repeatDaysInput.value = Array.from(document.querySelectorAll('.gbr-day-btn.active')).map(b => b.dataset.day).join(',');
          updatePreview();
        });
      });

      // Select first day by default
      dayBtns[0].classList.add('active');
      selectedDay = 'monday';
      repeatDaysInput.value = 'monday';

      // Drag and drop
      let draggedCard = null;

      bossList.addEventListener('dragstart', (e) => {
        draggedCard = e.target.closest('.gbr-boss-card');
        if (draggedCard) draggedCard.classList.add('dragging');
      });

      bossList.addEventListener('dragend', (e) => {
        if (draggedCard) draggedCard.classList.remove('dragging');
        draggedCard = null;
      });

      bossList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(bossList, e.clientY);
        if (draggedCard) {
          if (afterElement == null) {
            bossList.appendChild(draggedCard);
          } else {
            bossList.insertBefore(draggedCard, afterElement);
          }
        }
      });

      bossList.addEventListener('drop', (e) => {
        e.preventDefault();
        updateOrder();
      });

      function getDragAfterElement(container, y) {
        const elements = [...container.querySelectorAll('.gbr-boss-card:not(.dragging)')];
        return elements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
          }
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      function updateOrder() {
        const cards = bossList.querySelectorAll('.gbr-boss-card');
        const order = [];
        cards.forEach((card, i) => {
          card.querySelector('.gbr-boss-num').textContent = i + 1;
          order.push(card.dataset.bossKey);
        });
        orderInput.value = order.join(',');
        updatePreview();
      }

      function updatePreview() {
        const order = orderInput.value.split(',');
        const initials = order.map(k => BOSS_MAP[k]?.initial ?? k).join(' → ');
        const names = order.map(k => BOSS_MAP[k]?.name ?? k).join(' → ');
        previewInitials.textContent = initials;
        previewNames.textContent = names;

        const dayLabel = selectedDay ? selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1) : 'Monday';
        previewTitle.textContent = 'Guild Boss Raid - ' + dayLabel;

        const bossTime = document.querySelector('[name="bossTime"]').value;
        const announceTime = document.querySelector('[name="announcementTime"]').value;
        if (bossTime) {
          const [h, m] = bossTime.split(':');
          const hr = parseInt(h);
          previewTime.textContent = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
        }
        if (announceTime) {
          const [h, m] = announceTime.split(':');
          const hr = parseInt(h);
          const formatted = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
          previewAnnounce.textContent = formatted;
          previewAnnounceTime.textContent = formatted;
        }
      }

      // Update preview on input changes
      document.querySelector('[name="bossTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="announcementTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="recurrence"]').addEventListener('change', updatePreview);

      updatePreview();
    })();
  </script>`;
}
