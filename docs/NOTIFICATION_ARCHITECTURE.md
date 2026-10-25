# Notification architecture

Status: the existing in-app notification path is in use. Milestone 5 notification features are not implemented yet.

## Existing

- **In-app notifications.** Stored in `notifications` and written by trusted operations (for example schedule updates and match changes). Players can read their own notifications and mark them read. Clients cannot create or delete them.
- **Team schedule notices.** `notifyTeam` sends one consolidated notice per team after a bulk schedule change.
- **Push delivery.** The `deliverPush` function and `registerPushToken` operation exist. Delivery depends on the staging configuration described in [STAGING.md](STAGING.md) and has not been verified on a physical device.
- **Scheduled reminders.** Maintenance reminders are deduplicated per individual and per team (`deduplicates scheduled individual and team reminders` test).

## Not implemented yet

- Email delivery through an approved provider.
- User notification preferences beyond the existing push/in-app toggles.
- Quiet hours.
- Deep links to specific screens from every notification type.
- Reminder policies defined by organizers, and missing-score or confirmation-deadline reminders.
- Read/unread history beyond the existing notification list.

## Notes for the next slice

Use idempotent keys per (recipient, event type, entity, version) when adding new notification types, so retries and reruns do not duplicate messages.
