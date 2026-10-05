import { CallbackQueryContext, Context, InlineKeyboard } from "grammy";
import { saveEventUpdate, sendUpdatedEventCard } from "../events-utils.js";
import { userSessions } from "../../../session/store.js";
import {
  EditingFieldType,
  PriorityType,
  WizardStep,
} from "../../../types/session.js";

/**
 * Callback Query: Direct Pushpin Selection (select_event_X)
 * Delegates rendering directly to sendUpdatedEventCard
 */
export async function selectEventCQB(ctx: CallbackQueryContext<Context>) {
  const eventId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from?.id;

  if (!telegramId) return;

  try {
    await ctx.answerCallbackQuery();
    // Render event card with all details and dynamic document button
    await sendUpdatedEventCard(ctx, eventId, String(telegramId));
  } catch (error) {
    console.error("Error displaying selected event card:", error);
    await ctx.reply("❌ Error fetching event details.");
  }
}

/**
 * Callback Query: Main "Edit" button on event card
 */
export async function editEventCQB(ctx: CallbackQueryContext<Context>) {
  const eventId = ctx.match[1];
  const telegramId = ctx.from.id;

  // Ensure user session exists when opening the edit menu
  if (!userSessions.has(telegramId)) {
    userSessions.set(telegramId, { step: WizardStep.AWAITING_EDIT_VALUE });
  }

  await ctx.answerCallbackQuery();

  const editMenuKeyboard = new InlineKeyboard()
    .text("📌 Title", `edit_field_title_${eventId}`)
    .text("📄 Description", `edit_field_description_${eventId}`)
    .row()
    .text("📍 Location", `edit_field_location_${eventId}`)
    .text("🚨 Priority", `edit_field_priority_${eventId}`)
    .row()
    .text("📆 Start Time", `edit_field_start_time_${eventId}`)
    .text("🖼️ Image/Media", `edit_field_photo_${eventId}`)
    .row()
    .text("🔗 Link", `edit_field_link_${eventId}`)
    .text("🎥 Video", `edit_field_video_${eventId}`)
    .row()
    .text("📎 Document", `edit_field_document_${eventId}`);

  await ctx.reply("✏️ **Which field would you like to edit?**", {
    reply_markup: editMenuKeyboard,
    parse_mode: "Markdown",
  });
}
/**
 * Callback Query: Trigger Edit Wizard (Select Field to Modify)
 */
export async function editFieldEvent(ctx: CallbackQueryContext<Context>) {
  const field = ctx.match[1] as EditingFieldType;
  const eventId = parseInt(ctx.match[2], 10);
  const telegramId = ctx.from.id;

  // Get existing session OR create a new one for editing
  let session = userSessions.get(telegramId);
  if (!session) {
    session = { step: WizardStep.AWAITING_EDIT_VALUE };
    userSessions.set(telegramId, session);
  }

  // Store targeted field & event ID in user session state
  session.editingEventId = eventId;
  session.editingField = field;
  session.step = WizardStep.AWAITING_EDIT_VALUE;

  await ctx.answerCallbackQuery();

  // If editing priority, display the button keyboard directly
  if (field === "priority") {
    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "update_priority_low")
      .text("🟡 Medium", "update_priority_medium")
      .text("🔴 High", "update_priority_high");

    await ctx.reply("🚨 Select the new priority level:", {
      reply_markup: priorityKeyboard,
    });
    return;
  }

  // Prompt the user for input based on the chosen field
  const prompts: Record<EditingFieldType, string> = {
    title: "📌 Enter the new <b>title</b>:",
    description: "📄 Enter the new <b>description</b>:",
    location: "📍 Enter the new <b>location</b>:",
    priority: "",
    start_time:
      "📆 Enter the new start date and time (Format: <b>DD-MM-YYYY HH:MM</b>):",
    photo: "📸 Send a new <b>photo/image</b> to update this event:",
    link: "🔗 Enter the new <b>link</b>:",
    video: "🎥 Send a new <b>video</b> to update this event:",
    document: "📎 Send a <b>document/PDF</b> to attach to this event:",
  };

  await ctx.reply(prompts[field], { parse_mode: "HTML" });
}
/**
 * Callback Query Handler: Priority Selection
 */
export async function priorityEventTypeCQB(ctx: CallbackQueryContext<Context>) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);

  if (!session || session.step !== WizardStep.AWAITING_PRIORITY) {
    await ctx.answerCallbackQuery({
      text: "Session expired. Type /new_event again.",
    });
    return;
  }

  const selectedPriority = ctx.match[1] as PriorityType;
  session.priority = selectedPriority;
  session.step = WizardStep.AWAITING_DATE;

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Selected Priority: <b>${selectedPriority.toUpperCase()}</b>\n\n` +
      "📆 Enter the <b>start date and time</b> (Format: DD-MM-YYYY HH:MM):",
    { parse_mode: "HTML" },
  );
}

/**
 * Callback: Color Selection
 */
export async function colorEventPriorityCQB(
  ctx: CallbackQueryContext<Context>,
) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);
  if (!session || session.step !== WizardStep.AWAITING_COLOR) return;

  session.colorId = ctx.match[1];
  session.step = WizardStep.AWAITING_PRIORITY;

  await ctx.answerCallbackQuery();
  const priorityKeyboard = new InlineKeyboard()
    .text("🟢 Low", "priority_low")
    .text("🟡 Medium", "priority_medium")
    .text("🔴 High", "priority_high");

  await ctx.reply("🚨 Select the <b>priority level</b>:", {
    parse_mode: "HTML",
    reply_markup: priorityKeyboard,
  });
}

/**
 * Callback Query: Process Priority Selection during Editing
 */
export async function updatePriorityEventCQB(
  ctx: CallbackQueryContext<Context>,
) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);

  if (
    !session ||
    session.step !== WizardStep.AWAITING_EDIT_VALUE ||
    session.editingField !== "priority" ||
    !session.editingEventId
  ) {
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired or invalid. Please click Edit on the event card again.",
      show_alert: true,
    });
    return;
  }

  const newPriority = ctx.match[1] as PriorityType;
  const eventId = session.editingEventId;

  await ctx.answerCallbackQuery({
    text: `Priority updated to ${newPriority.toUpperCase()}`,
  });

  // Save and sync priority update
  await saveEventUpdate(ctx, telegramId, eventId, "priority", newPriority);
}
