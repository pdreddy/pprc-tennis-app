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
  ApiError,
  apiEnabled,
  apiClubId,
  createApiDivision,
  createApiTriaceEvent,
  createApiTournament,
  createApiEvent,
  getPublicApiEvent,
  getApiEvent,
  listPublicApiDivisions,
  listApiEventDivisions,
  listPublicApiEvents,
  listMyApiRegistrations,
  listApiNotifications,
  listApiEvents,
  markApiNotificationRead,
  registerForApiEvent,
  getMyApiMembership,
  joinApiClub,
  updateApiEvent,
  withdrawApiRegistration,
  type ApiDivision,
  type ApiEvent,
  type ApiNotification,
  type ApiRegistration,
} from "./api";
import { canManage, type Entity, type Event } from "@pprc/shared";
import { demoAuth, onDemoAuth } from "./demo-auth";
import { emergentAuth, onExternalAuth } from "./external-auth";
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
  useEffect(() => {
    const handle = (user: User | null) => {
      setUser(user);
      setLoading(false);
      qc.clear();
    };
    return demoAuth ? onDemoAuth(handle) : emergentAuth ? onExternalAuth(handle) : onAuthStateChanged(auth, handle);
  }, [qc]);
  const profile = useQuery<Entity | undefined>({
      queryKey: ["profile", user?.uid],
      queryFn: async (): Promise<Entity | undefined> => apiEnabled
        ? { id: user!.uid, clubId: apiClubId, displayName: user!.displayName ?? user!.email ?? user!.uid }
        : getOne("users", user!.uid),
      enabled: !!user,
    }),
    member = useQuery<Entity | undefined>({
      queryKey: ["member", user?.uid],
      queryFn: async (): Promise<Entity | undefined> => {
        if (!apiEnabled) return getOne("memberships", user!.uid);
        // A signed-in user who has not joined the club yet is a plain visitor, not an error.
        let membership = await getMyApiMembership().catch((error) => {
          if (error instanceof ApiError && error.status === 404) return undefined;
          throw error;
        });
        // Emergent sign-in: a new account joins PPRC as a player on first visit (ADMIN_EMAIL joins as admin).
        if (!membership && emergentAuth) membership = await joinApiClub();
        if (!membership) return undefined;
        const role = membership.role === "organizer" ? "eventAdmin" : ["owner", "admin"].includes(membership.role) ? "clubAdmin" : membership.role;
        return { id: membership.id, clubId: membership.club_id, role, displayName: membership.display_name };
      },
      enabled: !!user && (!apiEnabled || Boolean(apiClubId)),
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

export function toUiEvent(event: ApiEvent): Entity {
  const rules = event.rules ?? {};
  return {
    id: event.id,
    clubId: event.club_id,
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
    rules,
  };
}

function toUiDivision(division: ApiDivision): Entity {
  const rules = division.rules ?? {};
  return {
    id: division.id,
    clubId: division.club_id,
    eventId: division.event_id ?? undefined,
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
    rules,
  };
}

function toUiRegistration(registration: ApiRegistration): Entity {
  return {
    id: registration.id,
    clubId: registration.club_id,
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
    clubId: notification.club_id,
    title: notification.title,
    body: notification.body,
    eventId: String(notification.data.eventId ?? ""),
    link: notification.data.link ? String(notification.data.link) : notification.data.eventId ? `/events/${notification.data.eventId}` : "",
    kind: notification.kind,
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
    if (apiEnabled && name === "createTriaceEvent") {
      const divisions = data.divisions as import("./api").ApiDivisionInput[];
      if (divisions.length !== 1) throw new Error("TRIACE setup requires exactly one initial division");
      const event = await createApiTriaceEvent(data.event as import("./api").ApiEventInput, divisions[0]);
      await qc.invalidateQueries();
      return { eventId: event.id };
    }
    if (apiEnabled && name === "createTournament") {
      const event = await createApiTournament(data.event as import("./api").ApiEventInput, data.division as import("./api").ApiDivisionInput);
      await qc.invalidateQueries();
      return { eventId: event.id };
    }
    if (apiEnabled && name === "updateTriaceEvent") {
      const result = await updateApiEvent(String(data.eventId), data.event as Parameters<typeof updateApiEvent>[1]);
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
  const { user, member } = useSession();
  const staff = ["clubAdmin", "eventAdmin", "support"].includes(String(member?.role));
  return useQuery({
    queryKey: ["list", apiEnabled ? "api" : "firebase", collection, filters, user?.uid, staff],
    queryFn: async () => {
      if (apiEnabled && collection === "events") {
        // Visitors and players see published events; staff also see drafts.
        const events = apiClubId && staff ? await listApiEvents() : await listPublicApiEvents();
        return events.map(toUiEvent);
      }
      if (apiEnabled && collection === "registrations") {
        return (await listMyApiRegistrations()).map(toUiRegistration);
      }
      if (apiEnabled && collection === "notifications") {
        return (await listApiNotifications()).map(toUiNotification);
      }
      // Collections not served by FastAPI yet stay empty instead of querying Firestore.
      if (apiEnabled) return [];
      return getList(collection, filters);
    },
    enabled,
  });
}
export function useEvent(id: string) {
  const { user, member, loading } = useSession();
  const e = useQuery({
    queryKey: ["event", apiEnabled ? "api" : "firebase", id, user?.uid],
    queryFn: async () => {
      if (!apiEnabled) return getOne("events", id);
      const isAdmin = ["clubAdmin", "eventAdmin"].includes(String(member?.role));
      return toUiEvent(await (isAdmin ? getApiEvent(id) : getPublicApiEvent(id)));
    },
    enabled: !!id && !loading,
  });
  const admin = canManage(member?.role, user?.uid ?? "", e.data as Event);
  const support = member?.role === "platformAdmin";
  const filters: [string, any, any][] = [["eventId", "==", id]];
  const divisions = useQuery({
      queryKey: ["event-divisions", apiEnabled ? "api" : "firebase", id],
      queryFn: async () => apiEnabled
        ? (await (["clubAdmin", "eventAdmin"].includes(String(member?.role)) ? listApiEventDivisions(id) : listPublicApiDivisions(id))).map(toUiDivision)
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
