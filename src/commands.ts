import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const eventCommand = new SlashCommandBuilder()
  .setName("event")
  .setDescription("Manage BDO Node War roster events")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Open a private step-by-step Node War event setup wizard")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create-today")
      .setDescription("Create a one-time roster for today's Node War announcement")
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
      .setName("repost")
      .setDescription("Repost an event to the configured or selected Node War channel")
      .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
  );

export const setNodeWarChannelCommand = new SlashCommandBuilder()
  .setName("set-nwchannel")
  .setDescription("Set the current channel as the Node War announcement channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export const commands = [eventCommand.toJSON(), setNodeWarChannelCommand.toJSON()];
