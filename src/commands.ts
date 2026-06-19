import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const eventCommand = new SlashCommandBuilder()
  .setName("event")
  .setDescription("Manage guild events — Node War, GBR, and Custom")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Open a private step-by-step event setup wizard (Node War, GBR, or Custom)")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create-today")
      .setDescription("Create a one-time event for today")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create-test")
      .setDescription("Create a test roster announcement for a selected day and time")
      .addStringOption((option) =>
        option
          .setName("day")
          .setDescription("Node War day to use for the test roster")
          .setRequired(true)
          .addChoices(
            { name: "Sunday", value: "sunday" },
            { name: "Monday", value: "monday" },
            { name: "Tuesday", value: "tuesday" },
            { name: "Wednesday", value: "wednesday" },
            { name: "Thursday", value: "thursday" },
            { name: "Friday", value: "friday" },
            { name: "Saturday", value: "saturday" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("time")
          .setDescription("Announcement time in 24-hour HH:mm, Singapore time")
          .setRequired(true)
          .setMaxLength(5)
      )
      .addRoleOption((option) =>
        option
          .setName("ping-role")
          .setDescription("Role to ping when the test announcement posts")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List upcoming roster events"))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("show")
      .setDescription("Show event information")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("edit")
      .setDescription("Open a private edit wizard for an existing Node War event")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set-slots")
      .setDescription("Set T1 DEF, ZERK, and SHAI slots; FFA/Mainball is recalculated")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
      .addIntegerOption((option) =>
        option.setName("def").setDescription("Defense slots").setRequired(true).setMinValue(0).setMaxValue(200)
      )
      .addIntegerOption((option) =>
        option.setName("zerk").setDescription("Zerker slots").setRequired(true).setMinValue(0).setMaxValue(200)
      )
      .addIntegerOption((option) =>
        option.setName("shai").setDescription("Shai slots").setRequired(true).setMinValue(0).setMaxValue(200)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("recurring")
      .setDescription("Enable or disable weekly recurrence")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
      .addBooleanOption((option) => option.setName("enabled").setDescription("Repeat weekly").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Delete an event")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("close")
      .setDescription("Close an event to prevent new signups")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("repost")
      .setDescription("Repost an event to the configured or selected Node War channel")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  );

export const setNodeWarChannelCommand = new SlashCommandBuilder()
  .setName("set-nwchannel")
  .setDescription("Set the current channel as the Node War announcement channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export const exportCommand = new SlashCommandBuilder()
  .setName("export")
  .setDescription("Export Project Athena data to Discord")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stats")
      .setDescription("Post a formatted guild scoreboard summary in this channel")
  );

export const scoreCommand = new SlashCommandBuilder()
  .setName("score")
  .setDescription("Manage scoreboard screenshots")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set-channel")
      .setDescription("Use this channel for command-approved scoreboard screenshots")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("upload")
      .setDescription("Authorize your next scoreboard screenshot upload in this channel")
      .addStringOption((option) =>
        option
          .setName("war-date")
          .setDescription("War date as YYYY-MM-DD")
          .setRequired(true)
          .setMaxLength(10)
      )
      .addStringOption((option) =>
        option
          .setName("result")
          .setDescription("War result")
          .setRequired(false)
          .addChoices(
            { name: "Win", value: "win" },
            { name: "Loss", value: "loss" },
            { name: "Unknown", value: "unknown" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Optional report title")
          .setRequired(false)
          .setMaxLength(120)
      )
  );

export const commands = [eventCommand.toJSON(), setNodeWarChannelCommand.toJSON(), exportCommand.toJSON(), scoreCommand.toJSON()];

