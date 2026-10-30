import { auth } from "./firebase";

/** FastAPI boundary for the fresh PPRC PostgreSQL backend. */
export const apiEnabled = import.meta.env.VITE_DATA_PROVIDER === "api";
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
export const apiClubId = import.meta.env.VITE_PPRC_CLUB_ID || "";
export const apiClubSlug = import.meta.env.VITE_PPRC_CLUB_SLUG || "pprc";

export type ApiEvent = {
  id: string;
  club_id: string;
  name: string;
  starts_at: string;
  capacity: number;
  entry_fee_cents: number;
  status: "draft" | "published" | "closed" | "completed";
  rules: Record<string, unknown>;
};

export type ApiNotification = {
  id: string;
  club_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type ApiDivision = {
  id: string;
  club_id: string;
  event_id: string | null;
  name: string;
  format: string;
  capacity: number;
  rules: Record<string, unknown>;
};

export type ApiRegistration = {
  id: string;
  club_id: string;
  event_id: string;
  user_id: string;
  status: "pending" | "confirmed" | "waitlisted" | "withdrawn";
  waitlist_position: number | null;
  checked_in_at: string | null;
};

export type ApiMembership = {
  id: string;
  club_id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "admin" | "organizer" | "player" | "support";
};

export type ApiEventInput = {
  name: string;
  starts_at: string;
  capacity: number;
  entry_fee_cents: number;
  rules: Record<string, unknown>;
};

export type ApiDivisionInput = {
  name: string;
  format: string;
  capacity: number;
  min_rating?: number;
  max_rating?: number;
  rules: Record<string, unknown>;
};

export type ApiTeam = { id: string; club_id: string; division_id: string | null; name: string; captain_user_id: string; status: "pending" | "approved" | "rejected" };
export type ApiFixture = { id: string; club_id: string; division_id: string; home_team_id: string; away_team_id: string; starts_at: string; score_home: number | null; score_away: number | null; winner_team_id: string | null; status: string; result_detail: Record<string, unknown>; round_name: string; bracket_position: number | null };
export type ApiStanding = { id: string; division_id: string | null; subject_id: string; played: number; wins: number; losses: number; points: number };
export type ApiAuditLog = { id: string; club_id: string; actor_id: string; action: string; entity_type: string; entity_id: string; detail: string | null; created_at: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI returns `detail` as a string, or as a list of validation issues for 422s. */
function errorMessage(payload: unknown, status: number): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      const issue = item as { loc?: unknown[]; msg?: string };
      const field = Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== "body").join(".") : "";
      return field ? `${field}: ${issue.msg}` : issue.msg;
    });
    return messages.filter(Boolean).join("; ") || `PPRC API request failed (${status})`;
  }
  return `PPRC API request failed (${status})`;
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new ApiError("Unable to reach the PPRC API. Check your connection and try again.", 0);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(errorMessage(payload, response.status), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  // On a fresh page load currentUser is null until Firebase restores the session.
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ApiError("Sign in before using the PPRC API", 401);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return send<T>(path, { ...init, headers });
}

export const publicApiRequest = <T>(path: string, init: RequestInit = {}): Promise<T> => send<T>(path, init);

export const listApiEvents = () => apiRequest<ApiEvent[]>(`/v1/clubs/${apiClubId}/events`);
export const listPublicApiEvents = () => publicApiRequest<ApiEvent[]>(`/v1/public/clubs/${apiClubSlug}/events`);
export const getPublicApiEvent = (eventId: string) => publicApiRequest<ApiEvent>(`/v1/public/events/${eventId}`);
export const listPublicApiDivisions = (eventId: string) => publicApiRequest<ApiDivision[]>(`/v1/public/events/${eventId}/divisions`);
export const getApiEvent = (eventId: string) => apiRequest<ApiEvent>(`/v1/events/${eventId}`);
export const getMyApiMembership = () => apiRequest<ApiMembership>(`/v1/clubs/${apiClubId}/memberships/me`);
export const createApiEvent = (event: ApiEventInput) => apiRequest<ApiEvent>(`/v1/clubs/${apiClubId}/events`, { method: "POST", body: JSON.stringify(event) });
export const createApiTriaceEvent = (event: ApiEventInput, division: ApiDivisionInput) => apiRequest<ApiEvent>(`/v1/clubs/${apiClubId}/triace-events`, { method: "POST", body: JSON.stringify({ event, division }) });
export const updateApiEvent = (eventId: string, event: Partial<ApiEventInput> & { status?: ApiEvent["status"]; audit_reason: string }) => apiRequest<ApiEvent>(`/v1/events/${eventId}`, { method: "PATCH", body: JSON.stringify(event) });
export const createApiDivision = (eventId: string, division: ApiDivisionInput) => apiRequest<ApiDivision>(`/v1/events/${eventId}/divisions`, { method: "POST", body: JSON.stringify(division) });
export const listApiTeams = (divisionId?: string) => apiRequest<ApiTeam[]>(`/v1/clubs/${apiClubId}/teams${divisionId ? `?division_id=${divisionId}` : ""}`);
export const createApiTeam = (team: { division_id: string; name: string; members: { user_id: string; rating: number; lineup_position: number }[] }) => apiRequest<ApiTeam>(`/v1/clubs/${apiClubId}/teams`, { method: "POST", body: JSON.stringify(team) });
export const approveApiTeam = (teamId: string) => apiRequest<ApiTeam>(`/v1/teams/${teamId}/approve`, { method: "POST" });
export const listApiFixtures = (divisionId: string) => apiRequest<ApiFixture[]>(`/v1/clubs/${apiClubId}/fixtures?division_id=${divisionId}`);
export const createApiFixture = (fixture: { division_id: string; home_team_id: string; away_team_id: string; starts_at: string }) => apiRequest<ApiFixture>(`/v1/clubs/${apiClubId}/fixtures`, { method: "POST", body: JSON.stringify(fixture) });
export const submitApiFixtureResult = (fixtureId: string, result: { score_home: number; score_away: number; home_singles_player_ids: string[]; away_singles_player_ids: string[] }) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/result`, { method: "POST", body: JSON.stringify(result) });
export const reportApiFixtureResult = (fixtureId: string, result: { score_home: number; score_away: number; home_singles_player_ids: string[]; away_singles_player_ids: string[]; rubbers?: { kind: "singles" | "doubles" | "super_tiebreak"; home_player_ids: string[]; away_player_ids: string[]; home_score: number; away_score: number }[] }) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/report-result`, { method: "POST", body: JSON.stringify(result) });
export const confirmApiFixtureResult = (fixtureId: string) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/confirm-result`, { method: "POST" });
export const disputeApiFixtureResult = (fixtureId: string, reason: string) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/dispute-result`, { method: "POST", body: JSON.stringify({ reason }) });
export const correctApiFixtureResult = (fixtureId: string, result: { score_home: number; score_away: number; home_singles_player_ids: string[]; away_singles_player_ids: string[]; audit_reason: string }) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/correct-result`, { method: "POST", body: JSON.stringify(result) });
export const listApiStandings = (divisionId: string) => apiRequest<ApiStanding[]>(`/v1/divisions/${divisionId}/standings`);
export const generateApiPlayoffs = (divisionId: string, input: { size: number; starts_at: string; final_starts_at?: string }) => apiRequest<ApiFixture[]>(`/v1/divisions/${divisionId}/playoffs/generate`, { method: "POST", body: JSON.stringify(input) });
export const getApiChampion = (divisionId: string) => apiRequest<{ champion_team_id: string | null; champion_team_name: string | null }>(`/v1/divisions/${divisionId}/champion`);
export const registerForApiEvent = (eventId: string) => apiRequest(`/v1/events/${eventId}/registrations`, { method: "POST" });
export const listMyApiRegistrations = () => apiRequest<ApiRegistration[]>("/v1/me/registrations");
export const withdrawApiRegistration = (registrationId: string) => apiRequest(`/v1/registrations/${registrationId}/withdraw`, { method: "POST" });
export const listApiNotifications = () => apiRequest<ApiNotification[]>("/v1/notifications");
export const markApiNotificationRead = (notificationId: string) => apiRequest(`/v1/notifications/${notificationId}/read`, { method: "POST" });
export const listApiAuditLogs = (entityId?: string) => apiRequest<ApiAuditLog[]>(`/v1/clubs/${apiClubId}/audit-logs${entityId ? `?entity_id=${encodeURIComponent(entityId)}` : ""}`);

/** Individual (singles) tournament formats served by FastAPI. TRIACE keeps its own team workflow. */
export const tournamentFormats = [
  { key: "triace_team_round_robin", label: "TRIACE 2.0", description: "Three-player teams play a round robin, then playoffs.", individual: false },
  { key: "round_robin", label: "Round robin", description: "Everyone plays everyone once; the table decides the winner.", individual: true },
  { key: "single_elimination", label: "Single elimination", description: "Seeded knockout bracket with byes. Lose once and you are out.", individual: true },
  { key: "ladder", label: "Ladder", description: "Ongoing ranking. Challenge players above you and take their rank by winning.", individual: true },
] as const;
export type TournamentFormat = (typeof tournamentFormats)[number]["key"];
export const isIndividualFormat = (format: unknown) => tournamentFormats.some((item) => item.individual && item.key === format);

export type ApiEntry = { id: string; division_id: string; user_id: string; display_name: string; seed: number | null; rating: number | null; rank: number | null; status: string };
export type ApiCompetitionMatch = { id: string; division_id: string; round_number: number; round_name: string; position: number; player_one_id: string | null; player_two_id: string | null; winner_id: string | null; score_one: number | null; score_two: number | null; score_text: string | null; status: string; reported_by: string | null; starts_at: string | null };
export type ApiPlayerStanding = { subject_id: string; display_name: string; played: number; wins: number; losses: number; points: number };

export const createApiTournament = (event: ApiEventInput, division: ApiDivisionInput) => apiRequest<ApiEvent>(`/v1/clubs/${apiClubId}/tournaments`, { method: "POST", body: JSON.stringify({ event, division }) });
export const listApiEntries = (divisionId: string) => apiRequest<ApiEntry[]>(`/v1/divisions/${divisionId}/entries`);
export const addApiEntry = (divisionId: string, entry: { user_id?: string; display_name?: string; rating?: number; seed?: number } = {}) => apiRequest<ApiEntry>(`/v1/divisions/${divisionId}/entries`, { method: "POST", body: JSON.stringify(entry) });
export const withdrawApiEntry = (entryId: string) => apiRequest<ApiEntry>(`/v1/entries/${entryId}/withdraw`, { method: "POST" });
export const generateApiDraw = (divisionId: string, startsAt?: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/draw`, { method: "POST", body: JSON.stringify({ starts_at: startsAt ?? null }) });
export const listApiCompetitionMatches = (divisionId: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/competition-matches`);
export const listApiPlayerStandings = (divisionId: string) => apiRequest<ApiPlayerStanding[]>(`/v1/divisions/${divisionId}/player-standings`);
export const submitApiCompetitionResult = (matchId: string, result: { score_one: number; score_two: number; score_text?: string; audit_reason?: string }) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/result`, { method: "POST", body: JSON.stringify(result) });
export const confirmApiCompetitionResult = (matchId: string) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/confirm`, { method: "POST" });
export const disputeApiCompetitionResult = (matchId: string, reason: string) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) });
export const createApiLadderChallenge = (divisionId: string, opponentId: string) => apiRequest<ApiCompetitionMatch>(`/v1/divisions/${divisionId}/ladder/challenges`, { method: "POST", body: JSON.stringify({ opponent_id: opponentId }) });
export const cancelApiLadderChallenge = (matchId: string) => apiRequest<void>(`/v1/competition-matches/${matchId}/cancel`, { method: "POST" });
