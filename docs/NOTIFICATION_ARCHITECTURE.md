# Notification architecture

Status: the existing in-app notification path is in use. Milestone 5 notification features are not implemented yet.

## Existing

- **In-app notifications.** Stored in `notifications` and written by trusted operations (for example schedule updates and match changes). Players can read their own notifications and mark them read. Clients cannot create or delete them.
- **Team schedule notices.** `notifyTeam` sends one consolidated notice per team after a bulk schedule change.
- **Push delivery.** The `deliverPush` function and `registerPushToken` operation exist. Delivery depends on the staging configuration described in [STAGING.md](STAGING.md) and has not been verified on a physical device.
- **Scheduled reminders.** The five-minute maintenance job sends upcoming-match reminders (30 minutes ahead, per the shared `reminderPolicy`) and team-encounter reminders, deduplicated per player and per match by a fixed notification id.
- **Overdue score reminders.** A scheduled head-to-head match with no final result two hours after its start (`reminderPolicy.overdueScoreHours`) sends each player one "Score due" notification. Repeated runs send nothing new.
- **Rescheduling notices.** Requests, declines and applied changes notify the affected players in-app.

## Not implemented yet

- Email delivery through an approved provider.
- User notification preferences beyond the existing push/in-app toggles.
- Quiet hours.
- Deep links to specific screens from every notification type.
- Organizer-configurable reminder windows are set per event (`setReminderPolicy`, 5–240 minutes before a match and 1–48 hours after start for score-due reminders). Defaults come from the shared policy.
- Confirmation-deadline and registration-deadline reminders.
- Read/unread history beyond the existing notification list.

## Notes for the next slice

Use idempotent keys per (recipient, event type, entity, version) when adding new notification types, so retries and reruns do not duplicate messages.

## Notification preferences and quiet hours

Players set in-app, push and reminder choices and optional quiet hours on the inbox page (`saveNotificationPreferences`, own profile only). Reminder creation is held back when reminders are switched off or the local time falls inside quiet hours; quiet hours may cross midnight. Email delivery and FCM device tokens are still outside this step.
