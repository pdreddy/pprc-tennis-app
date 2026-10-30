import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { auth, getOne, getList, call } from "./firebase";
import {
  apiEnabled,
  getPublicApiEvent,
  listPublicApiDivisions,
  listPublicApiEvents,
  listMyApiRegistrations,
  listApiNotifications,
  markApiNotificationRead,
  registerForApiEvent,
  withdrawApiRegistration,
  type ApiDivision,
  type ApiEvent,
  type ApiNotification,
  type ApiRegistration,
} from "./api";
import { canManage, type Entity, type Event } from "@pprc/shared";
const Session = createContext<{
  user: User | null;
  profile: Entity | undefined;
  member: Entity | undefined;
  loading: boolean;
}>({ user: null, profile: undefined, member: undefined, loading: true });
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setUser(user);
        setLoading(false);
        qc.clear();
      }),
    [qc],
  );
  const profile = useQuery({
      queryKey: ["profile", user?.uid],
      queryFn: () => getOne("users", user!.uid),
      enabled: !!user,
    }),
    member = useQuery({
      queryKey: ["member", user?.uid],
      queryFn: () => getOne("memberships", user!.uid),
      enabled: !!user,
    });
  return (
    <Session.Provider
      value={{
        user,
        profile: profile.data,
        member: member.data,
        loading: loading || profile.isLoading || member.isLoading,
      }}
    >
      {children}
    </Session.Provider>
  );
}
export const useSession = () => useContext(Session);

function toUiEvent(event: ApiEvent): Entity {
  const rules = event.rules ?? {};
  return {
    id: event.id,
    name: event.name,
    startDate: event.starts_at,
    endDate: String(rules.endDate ?? event.starts_at),
    capacity: event.capacity,
    fee: event.entry_fee_cents / 100,
    status: event.status === "published" ? "Registration Open" : event.status,
    venue: String(rules.venue ?? "Prosper Premier Racquet Club"),
    location: String(rules.location ?? "Prosper, Texas"),
    timezone: String(rules.timezone ?? "America/Chicago"),
    description: String(rules.description ?? "PPRC competition and community event."),
    organizer: String(rules.organizer ?? "PPRC Events"),
    registrationClose: String(rules.registrationClose ?? event.starts_at),
    waitlist: rules.waitlist !== false,
    questions: [],
    waiverRequired: false,
    refundPolicy: String(rules.refundPolicy ?? "Contact the event organizer for the current refund policy."),
  };
}

function toUiDivision(division: ApiDivision): Entity {
  const rules = division.rules ?? {};
  return {
    id: division.id,
    eventId: division.event_id,
    name: division.name,
    format: division.format,
    capacity: division.capacity,
    fee: typeof rules.fee === "number" ? rules.fee : undefined,
    gender: String(rules.gender ?? "Open"),
    minRating: rules.minRating ?? "—",
    maxRating: rules.maxRating ?? "—",
    minAge: rules.minAge ?? "—",
    maxAge: rules.maxAge ?? "—",
    eligibilityNotes: String(rules.eligibilityNotes ?? "See event rules."),
    scoring: String(rules.scoring ?? "best-of-3"),
  };
}

function toUiRegistration(registration: ApiRegistration): Entity {
  return {
    id: registration.id,
    eventId: registration.event_id,
    playerId: registration.user_id,
    state: registration.status === "confirmed" ? "Registered" : registration.status === "waitlisted" ? "Waitlisted" : registration.status,
    checkIn: registration.checked_in_at ? "Checked in" : "Not checked in",
    waitlistPosition: registration.waitlist_position,
  };
}

function toUiNotification(notification: ApiNotification): Entity {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    eventId: String(notification.data.eventId ?? ""),
    read: Boolean(notification.read_at),
    createdAt: notification.created_at,
  };
}

export function useAction() {
  const qc = useQueryClient();
  return async (name: string, data: Record<string, unknown> = {}) => {
    if (apiEnabled && name === "registerForDivision") {
      const result = await registerForApiEvent(String(data.eventId));
      await qc.invalidateQueries();
      return result;
    }
    if (apiEnabled && name === "cancelRegistration") {
      const result = await withdrawApiRegistration(String(data.registrationId));
      await qc.invalidateQueries();
      return result;
    }
    if (apiEnabled && name === "markNotificationRead") {
      const result = await markApiNotificationRead(String(data.notificationId));
      await qc.invalidateQueries();
      return result;
    }
    const result = await call(name, data);
    await qc.invalidateQueries();
    return result;
  };
}
export function useList(
  collection: string,
  filters: [string, any, any][] = [],
  enabled = true,
) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["list", apiEnabled ? "api" : "firebase", collection, filters, user?.uid],
    queryFn: async () => {
      if (apiEnabled && collection === "events") {
        const events = await listPublicApiEvents();
        return events.map(toUiEvent);
      }
      if (apiEnabled && collection === "registrations") {
        return (await listMyApiRegistrations()).map(toUiRegistration);
      }
      if (apiEnabled && collection === "notifications") {
        return (await listApiNotifications()).map(toUiNotification);
      }
      return getList(collection, filters);
    },
    enabled,
  });
}
export function useEvent(id: string) {
  const { user, member, loading } = useSession();
  const e = useQuery({
    queryKey: ["event", apiEnabled ? "api" : "firebase", id, user?.uid],
    queryFn: async () => apiEnabled ? toUiEvent(await getPublicApiEvent(id)) : getOne("events", id),
    enabled: !!id && !loading,
  });
  const admin = canManage(member?.role, user?.uid ?? "", e.data as Event);
  const support = member?.role === "platformAdmin";
  const filters: [string, any, any][] = [["eventId", "==", id]];
  const divisions = useQuery({
      queryKey: ["event-divisions", apiEnabled ? "api" : "firebase", id],
      queryFn: async () => apiEnabled
        ? (await listPublicApiDivisions(id)).map(toUiDivision)
        : getList("divisions", filters),
      enabled: !!e.data,
    }),
    draws = useList(
      "draws",
      [
        ...filters,
        ...(!admin && !support
          ? [["published", "==", true] as [string, any, any]]
          : []),
      ],
      !!e.data,
    );
  const matches = useList(
    "matches",
    [
      ...filters,
      ...(!admin && !support
        ? [["published", "==", true] as [string, any, any]]
        : []),
    ],
    !!e.data && !!draws.data?.length,
  );
  const registrations = useList(
    "registrations",
    [
      ...filters,
      ...(!admin && !support
        ? [["playerId", "==", user?.uid ?? "guest"] as [string, any, any]]
        : []),
    ],
    !!e.data && !!user,
  );
  const results = useList(
    "matchResults",
    [
      ...filters,
      ...(!admin && !support
        ? [
            ["state", "==", "Final"] as [string, any, any],
            ["published", "==", true] as [string, any, any],
          ]
        : []),
    ],
    !!e.data,
  );
  return {
    event: e.data,
    divisions: divisions.data ?? [],
    draws: draws.data ?? [],
    matches: matches.data ?? [],
    registrations: registrations.data ?? [],
    results: results.data ?? [],
    admin,
    support,
    loading: e.isLoading || divisions.isLoading,
    error:
      e.error ??
      divisions.error ??
      draws.error ??
      matches.error ??
      registrations.error ??
      results.error,
  };
}
