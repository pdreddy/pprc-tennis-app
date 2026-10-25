# Notification architecture

Status: partial. In-app notices/read state, user preferences/quiet hours, upcoming/overdue reminders and individual rescheduling notices are implemented. Durable job/retry records, complete deadline coverage and approved email delivery remain missing.

## Existing

- **In-app notifications.** Stored in `notifications` and written by trusted operations (for example schedule updates and match changes). Players can read their own notifications and mark them read. Clients cannot create or delete them.
- **Team schedule notices.** `notifyTeam` sends one consolidated notice per team after a bulk schedule change.
- **Push delivery.** The `deliverPush` function and `registerPushToken` operation exist. Delivery depends on the staging configuration described in [STAGING.md](STAGING.md) and has not been verified on a physical device.
- **Scheduled reminders.** The five-minute maintenance job sends upcoming-match reminders (30 minutes ahead, per the shared `reminderPolicy`) and team-encounter reminders, deduplicated per player and per match by a fixed notification id.
- **Overdue score reminders.** A scheduled head-to-head match with no final result two hours after its start (`reminderPolicy.overdueScoreHours`) sends each player one "Score due" notification. Repeated runs send nothing new.
- **Rescheduling notices.** Requests, declines and applied changes notify the affected players in-app.

## Not implemented yet

- Email delivery through an approved provider.
- Deep links to specific screens from every notification type.
- Durable reminder job/delivery retry state and full deadline reminder policies.
- Confirmation-deadline and registration-deadline reminders.
- History filtering beyond the existing read/unread notification list.

## Notes for the next slice

Use idempotent keys per (recipient, event type, entity, version) when adding new notification types, so retries and reruns do not duplicate messages.

## Notification preferences and quiet hours

Players set in-app, push and reminder choices and optional quiet hours on the inbox page (`saveNotificationPreferences`, own profile only). Reminder creation is held back when reminders are switched off or the local time falls inside quiet hours; quiet hours may cross midnight. Email delivery and FCM device tokens are still outside this step.

The October 25 profile-save regression fix preserves stored reminder/quiet-hour settings when identity fields are edited. Inbox opt-out is also preserved by the profile form. This does not imply every business notice currently honors in-app opt-out; audit that path separately.
