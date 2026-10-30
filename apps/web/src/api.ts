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
export type ApiFixture = { id: string; club_id: string; division_id: string; home_team_id: string; away_team_id: string; starts_at: string; score_home: number | null; score_away: number | null; winner_team_id: string | null; status: string; round_name: string; bracket_position: number | null };
export type ApiStanding = { id: string; division_id: string | null; subject_id: string; played: number; wins: number; losses: number; points: number };

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in before using the PPRC API");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `PPRC API request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function publicApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `PPRC API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

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
export const correctApiFixtureResult = (fixtureId: string, result: { score_home: number; score_away: number; home_singles_player_ids: string[]; away_singles_player_ids: string[]; audit_reason: string }) => apiRequest<ApiFixture>(`/v1/fixtures/${fixtureId}/correct-result`, { method: "POST", body: JSON.stringify(result) });
export const listApiStandings = (divisionId: string) => apiRequest<ApiStanding[]>(`/v1/divisions/${divisionId}/standings`);
export const generateApiPlayoffs = (divisionId: string, input: { size: number; starts_at: string; final_starts_at?: string }) => apiRequest<ApiFixture[]>(`/v1/divisions/${divisionId}/playoffs/generate`, { method: "POST", body: JSON.stringify(input) });
export const getApiChampion = (divisionId: string) => apiRequest<{ champion_team_id: string | null; champion_team_name: string | null }>(`/v1/divisions/${divisionId}/champion`);
export const registerForApiEvent = (eventId: string) => apiRequest(`/v1/events/${eventId}/registrations`, { method: "POST" });
export const listMyApiRegistrations = () => apiRequest<ApiRegistration[]>("/v1/me/registrations");
export const withdrawApiRegistration = (registrationId: string) => apiRequest(`/v1/registrations/${registrationId}/withdraw`, { method: "POST" });
export const listApiNotifications = () => apiRequest<ApiNotification[]>("/v1/notifications");
export const markApiNotificationRead = (notificationId: string) => apiRequest(`/v1/notifications/${notificationId}/read`, { method: "POST" });
