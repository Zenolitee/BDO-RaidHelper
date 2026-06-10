import { ChatInputCommandInteraction, ButtonInteraction, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import type { EventStore } from '../store.js';
import type { WarEvent } from '../types.js';

async function assertButtonGuild(store: EventStore, interaction: ButtonInteraction, eventId: string): Promise<void> {
  const event = await store.getEvent(eventId);
  if (!event || !interaction.guildId || event.guildId !== interaction.guildId) {
    throw new Error("This event does not belong to this server.");
  }
}

function requireButtonGuildId(interaction: ButtonInteraction): string {
  if (!interaction.guildId) {
    throw new Error("Use this button inside a Discord server.");
  }
  return interaction.guildId;
}

function assertListButtonOwner(interaction: ButtonInteraction, userId?: string): void {
  if (!userId || interaction.user.id !== userId) {
    throw new Error("Only the Administrator who opened this event list can use these buttons.");
  }
}

async function requireAdministrator(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return;
  }

  throw new Error("Only server Administrators can use bot commands.");
}

async function requireOfficer(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return;
  }

  if (config.officerRoleId && memberHasRole(interaction, config.officerRoleId)) {
    return;
  }

  throw new Error("Only Administrators or configured officers can do that.");
}

function memberHasRole(interaction: ChatInputCommandInteraction | ButtonInteraction, roleId: string): boolean {
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }

  if (roles && typeof roles === "object" && "cache" in roles) {
    return roles.cache.has(roleId);
  }

  return false;
}

export { assertButtonGuild, requireButtonGuildId, assertListButtonOwner, requireAdministrator, requireOfficer, memberHasRole };
