import { escapeHtml } from '../utils.js';
import { renderApp } from './layout.js';
import { TIMEZONE_OPTIONS } from '../../timezone.js';
import type { WebSession, GuildDeliveryOptions } from '../types.js';
import { config } from '../../config.js';

export function renderCreateCustomPage(
  guildId: string,
  csrfToken: string,
  session: WebSession,
  deliveryOptions: GuildDeliveryOptions,
  configuredChannelId?: string
): string {
  const content = `
    <div class="gbr-shell">
      <div class="gbr-topbar">
        <div class="gbr-title">
          <span>Custom Event Builder</span>
          <h1>Create Custom Event</h1>
        </div>
        <div class="gbr-actions-top">
          <a href="/create?guild=${escapeHtml(guildId)}" class="button button-ghost">Cancel</a>
          <button type="submit" class="button button-primary">Create Custom Event</button>
        </div>
      </div>
      <div class="gbr-create-page">
        <form id="custom-form" method="POST" action="/create">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <input type="hidden" name="guildId" value="${escapeHtml(guildId)}" />
          <input type="hidden" name="type" value="custom" />
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

              <label class="gbr-label">Event Time</label>
              <input type="time" name="eventTime" value="21:00" class="gbr-input" />

              <label class="gbr-label">Timezone</label>
              <select name="timezone" class="gbr-input">
                ${TIMEZONE_OPTIONS.map((tz) => `<option value="${escapeHtml(tz.value)}">${escapeHtml(tz.label)}</option>`).join("")}
              </select>

              <label class="gbr-label">Pick a day</label>
              <div class="gbr-days">
                <span class="gbr-day-btn" data-day="monday">MON</span>
                <span class="gbr-day-btn" data-day="tuesday">TUE</span>
                <span class="gbr-day-btn" data-day="wednesday">WED</span>
                <span class="gbr-day-btn" data-day="thursday">THU</span>
                <span class="gbr-day-btn" data-day="friday">FRI</span>
                <span class="gbr-day-btn" data-day="saturday">SAT</span>
                <span class="gbr-day-btn" data-day="sunday">SUN</span>
              </div>
            </div>
            <div class="gbr-panel-desc">Set when the bot should announce your custom event.</div>
          </div>

          <!-- Panel 02: Title -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">02</span> Title</div>
            <div class="gbr-panel-body">
              <label class="gbr-label">Event Title</label>
              <input type="text" name="title" id="custom-title" class="gbr-input" placeholder="e.g. Guild Siege Practice" maxlength="100" required />
            </div>
            <div class="gbr-panel-desc">Give your custom event a descriptive title.</div>
          </div>

          <!-- Panel 03: Description -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">03</span> Description</div>
            <div class="gbr-panel-body">
              <label class="gbr-label">Event Description</label>
              <textarea name="description" id="custom-description" class="gbr-input" rows="5" placeholder="Describe what this event is about, any requirements, or special instructions..." maxlength="500"></textarea>
            </div>
            <div class="gbr-panel-desc">Optional details to include in the event announcement.</div>
          </div>

          <!-- Panel 04: Delivery -->
          <div class="gbr-panel">
            <div class="gbr-panel-head"><span class="gbr-panel-num">04</span> Delivery</div>
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
            <div class="gbr-panel-desc">Choose where and who gets notified about the event.</div>
          </div>

          <!-- Panel 05: Live Preview -->
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
                  <div class="discord-message-mention" id="preview-ping" style="display:none;"></div>
                  <div class="discord-embed">
                    <div class="discord-embed-color-bar"></div>
                    <div class="discord-embed-body">
                      <div class="discord-embed-title" id="preview-title">Custom Event</div>
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
                          <div class="discord-embed-field-name">⏰ When</div>
                          <div class="discord-embed-field-value" id="preview-announce">in 2 hours</div>
                        </div>
                        <div class="discord-embed-field">
                          <div class="discord-embed-field-name">📊 Status</div>
                          <div class="discord-embed-field-value">Open</div>
                        </div>
                      </div>
                      <div class="discord-embed-divider" id="preview-desc-divider" style="display:none;"></div>
                      <div class="discord-embed-field-name" id="preview-desc-label" style="display:none;margin-bottom:6px;">📝 DESCRIPTION</div>
                      <div class="discord-embed-field-value" id="preview-description" style="display:none;color:#949ba4;margin-bottom:4px;"></div>
                      <div class="discord-embed-divider" id="preview-desc-bottom-divider" style="display:none;"></div>
                      <div class="discord-embed-field-value" id="preview-countdown" style="color:#949ba4;">⏱️ <strong>Starting in 2 hours</strong></div>
                    </div>
                  </div>
                  <div class="discord-embed-footer">Project Athena | Event CUSTOM-001</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
      </div>
    </div>
  `;

  return renderApp("Create Custom Event", content, { session, bodyClass: "custom-create-body", headExtra: '<link rel="stylesheet" href="/assets/css/custom-event.css">' })
    + renderCustomEventScript();
}

function renderCustomEventScript(): string {
  return `<script>
    (function() {
      const titleInput = document.getElementById('custom-title');
      const descriptionInput = document.getElementById('custom-description');
      const dayBtns = document.querySelectorAll('.gbr-day-btn');
      const repeatDaysInput = document.getElementById('repeat-days-value');
      const previewTitle = document.getElementById('preview-title');
      const previewDate = document.getElementById('preview-date');
      const previewTime = document.getElementById('preview-time');
      const previewAnnounce = document.getElementById('preview-announce');
      const previewAnnounceTime = document.getElementById('preview-announce-time');
      const previewCountdown = document.getElementById('preview-countdown');
      const previewDescLabel = document.getElementById('preview-desc-label');
      const previewDescDivider = document.getElementById('preview-desc-divider');
      const previewDescBottomDivider = document.getElementById('preview-desc-bottom-divider');
      const previewDescription = document.getElementById('preview-description');

      let selectedDay = '';

      // Day button selection — always single select
      dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          dayBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedDay = btn.dataset.day;
          repeatDaysInput.value = selectedDay;
          updatePreview();
        });
      });

      // Select first day by default
      dayBtns[0].classList.add('active');
      selectedDay = 'monday';
      repeatDaysInput.value = 'monday';

      function updatePreview() {
        // Title
        const title = titleInput.value.trim();
        if (title) {
          previewTitle.textContent = title;
        } else {
          previewTitle.textContent = 'Custom Event';
        }

        // Description
        const description = descriptionInput.value.trim();
        if (description) {
          previewDescription.textContent = description;
          previewDescription.style.display = '';
          previewDescLabel.style.display = '';
          previewDescDivider.style.display = '';
          previewDescBottomDivider.style.display = '';
        } else {
          previewDescription.style.display = 'none';
          previewDescLabel.style.display = 'none';
          previewDescDivider.style.display = 'none';
          previewDescBottomDivider.style.display = 'none';
        }

        // Time
        const eventTime = document.querySelector('[name="eventTime"]').value;
        const announceTime = document.querySelector('[name="announcementTime"]').value;
        if (eventTime) {
          const [h, m] = eventTime.split(':');
          const hr = parseInt(h);
          previewTime.textContent = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
        }
        if (announceTime) {
          const [h, m] = announceTime.split(':');
          const hr = parseInt(h);
          const formatted = (hr > 12 ? hr - 12 : hr) + ':' + m + (hr >= 12 ? ' PM' : ' AM');
          previewAnnounceTime.textContent = formatted;

          // Calculate countdown to next occurrence of selected day + announce time
          const now = new Date();
          const announceDate = new Date();
          const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
          const targetDay = dayMap[selectedDay] ?? 1;
          announceDate.setHours(parseInt(h), parseInt(m), 0, 0);

          // Find next occurrence of the target day
          const currentDay = now.getDay();
          let daysUntil = targetDay - currentDay;
          if (daysUntil < 0) daysUntil += 7;
          if (daysUntil === 0 && announceDate <= now) daysUntil = 7;

          announceDate.setDate(announceDate.getDate() + daysUntil);
          const diffMs = announceDate - now;
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffDays = Math.floor(diffHours / 24);
          const remainingHours = diffHours % 24;

          if (diffDays > 0) {
            previewAnnounce.textContent = 'in ' + diffDays + ' day' + (diffDays !== 1 ? 's' : '') + (remainingHours > 0 ? ' ' + remainingHours + 'h' : '');
          } else if (diffHours > 0) {
            previewAnnounce.textContent = 'in ' + diffHours + ' hour' + (diffHours !== 1 ? 's' : '');
          } else {
            previewAnnounce.textContent = 'soon';
          }
        }
      }

      // Update preview on input changes
      titleInput.addEventListener('input', updatePreview);
      descriptionInput.addEventListener('input', updatePreview);
      document.querySelector('[name="eventTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="announcementTime"]').addEventListener('input', updatePreview);
      document.querySelector('[name="recurrence"]').addEventListener('change', updatePreview);

      // Role ping preview
      const previewPing = document.getElementById('preview-ping');
      const roleSelect = document.querySelector('[name="announcementRoleIds"]');
      function updateRolePing() {
        const selected = roleSelect.options[roleSelect.selectedIndex];
        if (selected && selected.value) {
          previewPing.textContent = '@' + selected.textContent.replace(/^@/, '');
          previewPing.style.display = 'inline-block';
        } else {
          previewPing.style.display = 'none';
        }
      }
      roleSelect.addEventListener('change', updateRolePing);

      updatePreview();
    })();
  </script>`;
}
