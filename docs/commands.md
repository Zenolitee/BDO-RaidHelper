# Discord Commands

## Permissions

All registered slash commands require Discord server Administrator permission. Signup buttons are for guild members. Legacy management handlers allow Administrators and the configured `OFFICER_ROLE_ID`.

## Registered Commands

### `/event create`

Description: Opens a private step-by-step Node War setup wizard.

Parameters: None.

Permissions: Administrator.

Example:

```text
/event create
```

Wizard steps: tier, weekdays, one-time or weekly repeat mode, announcement time, ping role selection, Defense/Zerker/Shai slots, announcement channel, and confirmation.

### `/event create-today`

Description: Opens a one-time setup wizard for today's Node War weekday.

Parameters: None.

Permissions: Administrator.

Example:

```text
/event create-today
```

The current weekday is calculated in `TIMEZONE`. The wizard still collects tier, announcement time, ping roles, slots, and channel.

### `/event create-test`

Description: Creates a scheduled Tier 1 test announcement using a selected weekday, announcement time, and ping role.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `day` | Yes | Weekday choice from Sunday through Saturday. |
| `time` | Yes | Announcement time in 24-hour `HH:mm`. |
| `ping-role` | Yes | Discord role to mention when the test announcement posts. |

Permissions: Administrator.

Example:

```text
/event create-test day:monday time:22:15 ping-role:@NodeWar
```

The command uses the saved Node War channel and schedules the next occurrence of the selected weekday.

### `/event edit`

Description: Opens a private wizard for an existing event.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID. |

Permissions: Administrator.

Example:

```text
/event edit id:AbCdEf1234
```

The wizard edits raid days, announcement time, Mainball/FFA and specialist slots, and repeat mode.

### `/event recurring`

Description: Enables or disables weekly recurrence.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID. |
| `enabled` | Yes | `true` for weekly recurrence, `false` for one-time behavior. |

Permissions: Administrator.

Examples:

```text
/event recurring id:AbCdEf1234 enabled:true
/event recurring id:AbCdEf1234 enabled:false
```

Enabling recurrence uses existing repeat days when present, otherwise the event's current weekday. It also enables auto repost.

### `/event set-slots`

Description: Sets Tier 1 specialist capacities and recalculates Mainball/FFA.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID, matched case-insensitively. |
| `def` | Yes | Defense capacity from `0` to `200`. |
| `zerk` | Yes | Zerker capacity from `0` to `200`. |
| `shai` | Yes | Shai capacity from `0` to `200`. |

Permissions: Administrator.

Example:

```text
/event set-slots id:AbCdEf1234 def:5 zerk:2 shai:2
```

Mainball/FFA receives the remaining capacity. Existing overflow is moved to Bench.

### `/event repost`

Description: Immediately posts an event to the server's saved Node War channel.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID. |

Permissions: Administrator.

Example:

```text
/event repost id:AbCdEf1234
```

The command creates a new Discord message, records its ID, and sets `announcedAt`.

### `/event delete`

Description: Deletes an event from storage.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID, matched case-insensitively. |

Permissions: Administrator.

Example:

```text
/event delete id:AbCdEf1234
```

Deletion does not remove historical Discord messages.

### `/event list`

Description: Shows up to ten open events for the current Discord server with Edit and Delete buttons.

Parameters: None.

Permissions: Administrator.

Example:

```text
/event list
```

Only the Administrator who opened the private list can use its buttons.

### `/event show`

Description: Shows a private event preview, announcement schedule, and Post now, Edit, and Delete buttons.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID. |

Permissions: Administrator.

Example:

```text
/event show id:AbCdEf1234
```

### `/set-nwchannel`

Description: Saves the current Discord text channel as the Node War announcement channel for this server.

Parameters: None.

Permissions: Administrator.

Example:

```text
/set-nwchannel
```
### `/event close`

Description: Closes an event to prevent new signups.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `id` | Yes | Event ID. |

Permissions: Administrator.

Example:

```text
/event close id:AbCdEf1234
```

Closing an event prevents new signups while preserving existing roster state. One-time events also close automatically one hour after war start.

### `/export stats`

Description: Posts a formatted guild scoreboard summary in the current channel.

Parameters: None.

Permissions: None (available to all guild members).

Example:

```text
/export stats
```

### `/score set-channel`

Description: Sets the current channel as the approved scoreboard screenshot upload channel.

Parameters: None.

Permissions: Administrator.

Example:

```text
/score set-channel
```

### `/score upload`

Description: Authorizes the next scoreboard screenshot upload in this channel.

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `war-date` | Yes | War date as `YYYY-MM-DD`. |
| `result` | No | War result: `win`, `loss`, or `unknown`. |
| `title` | No | Optional report title (max 120 chars). |

Permissions: Administrator.

Example:

```text
/score upload war-date:2026-06-15 result:win title:"Node War - Calpheon"
```
## Requested Names Not Registered Today

### `/event rename`

Status: Not registered.

Current behavior: Node War titles are generated from weekday, tier, territory group, and participant capacity. There is no standalone rename flow.

### `/event set-time`

Status: Not registered.

Current behavior: Use `/event edit`, then choose `Time to post`. War start time is configured globally with `NODEWAR_START_TIME`.


## Posted Message Buttons

| Button | Who can use it | Behavior |
| --- | --- | --- |
| `FFA` | Guild member | Join or move to Mainball/FFA. |
| `DEF` | Guild member | Join or move to Defense, or Bench if full. |
| `ZERK` | Guild member | Join or move to Zerker, or Bench if full. |
| `SHAI` | Guild member | Join or move to Shai, or Bench if full. |
| `Sign off` | Guild member | Remove the member's signup. |
| `Post now` | Administrator | Immediately post the selected event from `/event show`. The underlying handler also accepts the configured officer role if invoked from an existing interaction. |

The router retains officer-aware handlers for older `Refresh` and `Close` custom IDs, but current message renderers do not create those buttons.
