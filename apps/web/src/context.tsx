import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth, getOne, getList, call } from "./firebase";
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
        profile: profile.data ?? undefined,
        member: member.data?.clubId === "pprc" ? member.data : undefined,
        loading: loading || profile.isLoading || member.isLoading,
      }}
    >
      {children}
    </Session.Provider>
  );
}
export const useSession = () => useContext(Session);
export function useAction() {
  const qc = useQueryClient();
  return async (name: string, data: Record<string, unknown> = {}) => {
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
    queryKey: ["list", collection, filters, user?.uid],
    queryFn: () => getList(collection, filters),
    enabled,
  });
}
export function useEvent(id: string) {
  const { user, member, loading } = useSession();
  const e = useQuery({
    queryKey: ["event", id, user?.uid],
    queryFn: () => getOne("events", id),
    enabled: !!id && !loading,
  });
  const admin = canManage(member?.role, user?.uid ?? "", e.data as Event);
  const support = member?.role === "platformAdmin";
  const filters: [string, any, any][] = [["eventId", "==", id]];
  const divisions = useList("divisions", filters, !!e.data),
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
    event: e.data ?? undefined,
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

// Scope each match query to one owned registration's event. This keeps parent
// event authorization provable and avoids exhausting rules document-read budgets
// when a player has matches across many events. Rules are unchanged.
export function usePlayerMatches() {
  const { user } = useSession();
  const registrations = useList(
    "registrations",
    [["playerId", "==", user?.uid ?? "guest"]],
    !!user,
  );
  const eventIds = [
    ...new Set((registrations.data ?? []).map((r) => String(r.eventId))),
  ].sort();
  const queries = useQueries({
    queries: eventIds.flatMap((eventId) =>
      ["p1", "p2"].map((side) => ({
        queryKey: ["owned-matches", eventId, side, user?.uid],
        queryFn: () =>
          getList("matches", [
            ["eventId", "==", eventId],
            [side, "==", user!.uid],
            ["published", "==", true],
          ]),
        enabled: !!user,
      })),
    ),
  });
  const isLoading = registrations.isLoading || queries.some((q) => q.isLoading);
  return {
    data: isLoading
      ? undefined
      : [
          ...new Map(
            queries.flatMap((q) => q.data ?? []).map((m) => [m.id, m]),
          ).values(),
        ],
    isLoading,
    error: registrations.error ?? queries.find((q) => q.error)?.error,
  };
}
