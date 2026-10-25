import type { Event } from "./index";

// Tournament discovery groupings. Status decides the group first, so a
// published event is never shown as completed just because its dates are
// in the past while play has not finished. Draft events are never listed
// publicly; callers filter them out before grouping.
export const discoveryGroups = ["upcoming", "active", "completed"] as const;
export type DiscoveryGroup = (typeof discoveryGroups)[number];

const activeStatuses = ["Check-In", "In Progress"];
const closedStatuses = ["Completed", "Cancelled"];

export function discoveryGroup(
  event: Partial<Pick<Event, "status" | "endDate">>,
  now: number,
): DiscoveryGroup {
  const status = event.status ?? "";
  if (activeStatuses.includes(status)) return "active";
  if (closedStatuses.includes(status)) return "completed";
  if (event.endDate && Date.parse(event.endDate) < now) return "completed";
  return "upcoming";
}

// Registration can be taken only while the event is open for it.
export function registrationOpenNow(
  event: Partial<
    Pick<Event, "status" | "registrationOpen" | "registrationClose">
  >,
  now: number,
) {
  if (event.status !== "Registration Open") return false;
  const opened =
    !event.registrationOpen || Date.parse(event.registrationOpen) <= now;
  const notClosed =
    !event.registrationClose || Date.parse(event.registrationClose) > now;
  return opened && notClosed;
}
