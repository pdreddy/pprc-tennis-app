import { auth } from "./firebase";
import { currentDemoUser, demoAuth } from "./demo-auth";
import { emergentAuth, getExternalToken } from "./external-auth";

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
  if (demoAuth) {
    const demoUser = currentDemoUser();
    if (!demoUser) throw new ApiError("Sign in before using the PPRC API", 401);
    const headers = new Headers(init.headers);
    headers.set("X-PPRC-User", demoUser.uid);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    return send<T>(path, { ...init, headers });
  }
  if (emergentAuth) {
    const token = await getExternalToken();
    if (!token) throw new ApiError("Sign in before using the PPRC API", 401);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    return send<T>(path, { ...init, headers });
  }
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
// Staff can read draft-event divisions; the public endpoint only serves published events.
export const listApiEventDivisions = async (eventId: string, clubId = apiClubId) => (await apiRequest<ApiDivision[]>(`/v1/clubs/${clubId}/divisions`)).filter((division) => division.event_id === eventId);
export const getApiEvent = (eventId: string) => apiRequest<ApiEvent>(`/v1/events/${eventId}`);
export const getMyApiMembership = () => apiRequest<ApiMembership>(`/v1/clubs/${apiClubId}/memberships/me`);
export const joinApiClub = () => apiRequest<ApiMembership>(`/v1/clubs/${apiClubId}/join`, { method: "POST" });
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
  { key: "groups_knockout", label: "Groups + knockout", description: "Seeds are snake-drawn into groups, each group plays a round robin, and the top finishers enter a knockout bracket.", individual: true },
  { key: "double_elimination", label: "Double elimination", description: "Winners and losers brackets: out after two losses, with a grand final reset.", individual: true },
  { key: "swiss", label: "Swiss", description: "A fixed number of rounds; each round pairs players with similar records.", individual: true },
  { key: "ladder", label: "Ladder", description: "Ongoing ranking. Challenge players above you and take their rank by winning.", individual: true },
] as const;
export type TournamentFormat = (typeof tournamentFormats)[number]["key"];
export const isIndividualFormat = (format: unknown) => tournamentFormats.some((item) => item.individual && item.key === format);

export type ApiEntry = { group_label: string | null; id: string; division_id: string; user_id: string; display_name: string; seed: number | null; rating: number | null; rank: number | null; status: string; partner_user_id: string | null; partner_name: string | null };
export type ApiCompetitionMatch = { id: string; division_id: string; round_number: number; round_name: string; position: number; player_one_id: string | null; player_two_id: string | null; winner_id: string | null; score_one: number | null; score_two: number | null; score_text: string | null; status: string; reported_by: string | null; starts_at: string | null };
export type ApiPlayerStanding = { group: string | null; subject_id: string; display_name: string; played: number; wins: number; losses: number; points: number; tiebreak?: number | null };

export const createApiTournament = (event: ApiEventInput, division: ApiDivisionInput) => apiRequest<ApiEvent>(`/v1/clubs/${apiClubId}/tournaments`, { method: "POST", body: JSON.stringify({ event, division }) });
export const listApiEntries = (divisionId: string) => apiRequest<ApiEntry[]>(`/v1/divisions/${divisionId}/entries`);
export const addApiEntry = (divisionId: string, entry: { user_id?: string; display_name?: string; rating?: number; seed?: number; partner_user_id?: string; partner_name?: string } = {}) => apiRequest<ApiEntry>(`/v1/divisions/${divisionId}/entries`, { method: "POST", body: JSON.stringify(entry) });
export const withdrawApiEntry = (entryId: string) => apiRequest<ApiEntry>(`/v1/entries/${entryId}/withdraw`, { method: "POST" });
export const generateApiDraw = (divisionId: string, startsAt?: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/draw`, { method: "POST", body: JSON.stringify({ starts_at: startsAt ?? null }) });
export const listApiCompetitionMatches = (divisionId: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/competition-matches`);
export const listApiPlayerStandings = (divisionId: string) => apiRequest<ApiPlayerStanding[]>(`/v1/divisions/${divisionId}/player-standings`);
export const submitApiCompetitionResult = (matchId: string, result: { score_one: number; score_two: number; score_text?: string; audit_reason?: string }) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/result`, { method: "POST", body: JSON.stringify(result) });
export const confirmApiCompetitionResult = (matchId: string) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/confirm`, { method: "POST" });
export const disputeApiCompetitionResult = (matchId: string, reason: string) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) });
export const createApiLadderChallenge = (divisionId: string, opponentId: string) => apiRequest<ApiCompetitionMatch>(`/v1/divisions/${divisionId}/ladder/challenges`, { method: "POST", body: JSON.stringify({ opponent_id: opponentId }) });
export const cancelApiLadderChallenge = (matchId: string) => apiRequest<void>(`/v1/competition-matches/${matchId}/cancel`, { method: "POST" });
export const generateApiSwissRound = (divisionId: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/swiss/next-round`, { method: "POST", body: JSON.stringify({}) });
export const awardApiWalkover = (matchId: string, winnerId: string, reason: string) => apiRequest<ApiCompetitionMatch>(`/v1/competition-matches/${matchId}/walkover`, { method: "POST", body: JSON.stringify({ winner_id: winnerId, reason }) });
export const advanceApiGroups = (divisionId: string) => apiRequest<ApiCompetitionMatch[]>(`/v1/divisions/${divisionId}/groups/advance`, { method: "POST", body: JSON.stringify({}) });

/** PPRC Rating, player profiles, rankings and player-reported results. */
export type RatingKind = "singles" | "doubles";
export type ApiRating = { rating: number; reliability: number; provisional: boolean; verified_matches: number; wins: number; losses: number; rank: number | null; last_played_at: string | null; formula_version: string };
export type ApiProfile = { user_id: string; display_name: string; city?: string | null; state?: string | null; home_club?: string | null; image_url?: string | null; preferred_sport?: string; has_profile: boolean; age_group?: string | null; gender_category?: string | null; visibility?: "public" | "club" | "private"; starting_singles?: number; starting_doubles?: number };
export type ApiSidePlayer = { user_id: string; display_name: string };
export type ApiResult = { id: string; source: "reported" | "competition"; kind: RatingKind; status: "reported" | "finalized" | "disputed" | "cancelled"; outcome: string; rated: boolean; score_text: string | null; winner_side: 1 | 2 | null; match_format: string; played_at: string; reported_by: string | null; dispute_reason: string | null; correction_reason: string | null; side_one: ApiSidePlayer[]; side_two: ApiSidePlayer[] };
export type ApiMilestone = { id: string; kind: RatingKind; type: "established" | "rank"; title: string; detail: string; date: string; rating: number; rank: number; field: number };
export type ApiPlayerDetail = { profile: ApiProfile; ratings: Record<RatingKind, ApiRating | null>; recent_form: ("W" | "L")[]; record: { wins: number; losses: number }; history: { kind: RatingKind; played_at: string; rating: number }[]; recent_matches?: ApiResult[]; doubles_partners?: ApiSidePlayer[]; milestones?: ApiMilestone[]; preferences?: { weekly_recap: boolean; monthly_digest?: boolean; email: string | null } };
export type ApiPage<T> = { items: T[]; total: number; page: number; page_size: number };
export type ApiDirectoryRow = ApiProfile & { rating: ApiRating | null };
export type ApiRankingRow = ApiProfile & ApiRating & { rank: number; movement?: number; club_name?: string };
export type ProfileInput = Omit<ApiProfile, "user_id" | "has_profile"> & { weekly_recap?: boolean; monthly_digest?: boolean };
export type ResultInput = { kind: RatingKind; partner_id?: string; opponent_ids: string[]; score_text?: string; outcome: string; match_format: string; winner_side?: 1 | 2; played_at?: string };

const query = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "" && value !== null) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const getMyPlayer = () => apiRequest<ApiPlayerDetail>(`/v1/clubs/${apiClubId}/players/me`);
export const saveMyPlayer = (profile: ProfileInput) => apiRequest<ApiPlayerDetail>(`/v1/clubs/${apiClubId}/players/me`, { method: "PUT", body: JSON.stringify(profile) });
export type ApiMember = { user_id: string; display_name: string; role: string; role_label: string; is_you: boolean };
export type ApiFairMatch = { user_id: string; display_name: string; city: string | null; image_url: string | null; rating: number; gap: number; provisional: boolean; reliability: number; head_to_head: { wins: number; losses: number } };
export const listMembers = () => apiRequest<ApiMember[]>(`/v1/clubs/${apiClubId}/members`);
export const setMemberRole = (userId: string, role: string) => apiRequest<ApiMember>(`/v1/clubs/${apiClubId}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) });
export const listFairMatches = (kind: RatingKind, spread: number) => apiRequest<ApiFairMatch[]>(`/v1/clubs/${apiClubId}/players/me/opponents?kind=${kind}&spread=${spread}`);
export const sendRecapsNow = () => apiRequest<{ week: string; sent: number; failed: number; opted_in: number }>(`/v1/clubs/${apiClubId}/recaps/send`, { method: "POST" });
export const sendMyRecap = () => apiRequest<{ sent_to: string }>(`/v1/clubs/${apiClubId}/recaps/me`, { method: "POST" });
export type ApiChallenge = { id: string; kind: RatingKind; status: "pending" | "accepted" | "declined" | "cancelled" | "completed" | "expired"; awaiting_you: boolean; expires_at: string | null; direction: "sent" | "received"; opponent: ApiSidePlayer; proposed_at: string | null; court: string | null; message: string | null; created_at: string; responded_at: string | null; result_id: string | null; result_status: string | null; emailed?: boolean };
export type ApiH2HChange = { before: number; after: number; delta: number } | null;
export type ApiH2HMatch = { id: string; kind: RatingKind; played_at: string; score_text: string | null; outcome: string; rated: boolean; a_won: boolean | null; a_partners: ApiSidePlayer[]; b_partners: ApiSidePlayer[]; a_change: ApiH2HChange; b_change: ApiH2HChange };
export type ApiH2HPlayer = { user_id: string; display_name: string; image_url: string | null; city: string | null; ratings: Record<RatingKind, ApiRating | null> };
export type ApiHeadToHead = { a: ApiH2HPlayer; b: ApiH2HPlayer; summary: Record<RatingKind, { a_wins: number; b_wins: number }>; matches: ApiH2HMatch[] };
export type EmailType = "weekly" | "monthly";
export type ApiEmailPreview = { type: EmailType; subject: string; html: string; recipients: number };
export const listChallenges = () => apiRequest<ApiChallenge[]>(`/v1/clubs/${apiClubId}/challenges`);
export const sendChallenge = (input: { opponent_id: string; proposed_at?: string; message?: string; court?: string }) => apiRequest<ApiChallenge>(`/v1/clubs/${apiClubId}/challenges`, { method: "POST", body: JSON.stringify(input) });
export const respondChallenge = (id: string, action: "accept" | "decline") => apiRequest<ApiChallenge>(`/v1/challenges/${id}/respond`, { method: "POST", body: JSON.stringify({ action }) });
export const cancelChallenge = (id: string) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/cancel`, { method: "POST" });
export const reportChallenge = (id: string, input: { score_text?: string; outcome: string; match_format: string; i_won?: boolean; played_at?: string }) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/result`, { method: "POST", body: JSON.stringify(input) });
export const proposeChallengeTime = (id: string, proposed_at: string, message?: string, court?: string) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/propose`, { method: "POST", body: JSON.stringify({ proposed_at, message, court }) });
export type ApiRivalry = { a: ApiSidePlayer; b: ApiSidePlayer; a_wins: number; b_wins: number; meetings: number; last_played_at: string };
export type ApiRivalries = { kind: RatingKind; most_played: ApiRivalry[]; closest: ApiRivalry[]; one_sided: ApiRivalry[] };
export const listRivalries = (kind: RatingKind) => apiRequest<ApiRivalries>(`/v1/clubs/${apiClubId}/rivalries?kind=${kind}`);
export type ApiChallengeSettings = { challenge_expiry_days: number; challenge_expiry_restarts: boolean; reminder_after_days: number };
export const getChallengeSettings = () => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`);
export const saveChallengeSettings = (days: number, restarts: boolean) => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`, { method: "PUT", body: JSON.stringify({ challenge_expiry_days: days, challenge_expiry_restarts: restarts }) });
export const getPublicHeadToHead = (a: string, b: string) => publicApiRequest<ApiHeadToHead>(`/v1/public/clubs/${apiClubSlug}/head-to-head/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
export const getHeadToHead = (a: string, b: string) => apiRequest<ApiHeadToHead>(`/v1/clubs/${apiClubId}/head-to-head/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
export const previewEmail = (type: EmailType, userId?: string) => apiRequest<ApiEmailPreview>(`/v1/clubs/${apiClubId}/emails/preview${query({ type, user_id: userId })}`);
export const sendTestEmail = (type: EmailType, userId?: string) => apiRequest<{ sent_to: string; type: EmailType }>(`/v1/clubs/${apiClubId}/emails/test`, { method: "POST", body: JSON.stringify({ type, user_id: userId || undefined }) });
export const uploadMyPhoto = (photo: Blob) => {
  const body = new FormData();
  body.append("file", photo, "photo.jpg");
  return apiRequest<{ image_url: string }>(`/v1/clubs/${apiClubId}/players/me/photo`, { method: "POST", body });
};
/** Stored photo paths are API-relative; resolve them against the API host. */
export const photoUrl = (url?: string | null) => (url && url.startsWith("/api/") ? `${apiBaseUrl.replace(/\/api$/, "")}${url}` : url ?? null);
export const getPlayer = (userId: string) => apiRequest<ApiPlayerDetail>(`/v1/clubs/${apiClubId}/players/${encodeURIComponent(userId)}`);
export const getPublicPlayer = (userId: string) => publicApiRequest<ApiPlayerDetail>(`/v1/public/clubs/${apiClubSlug}/players/${encodeURIComponent(userId)}`);
export const listPlayers = (filters: Record<string, unknown>) => apiRequest<ApiPage<ApiDirectoryRow>>(`/v1/clubs/${apiClubId}/players${query(filters)}`);
export const listClubRankings = (filters: Record<string, unknown>) => apiRequest<ApiPage<ApiRankingRow>>(`/v1/clubs/${apiClubId}/rankings${query(filters)}`);
export const listPlatformRankings = (filters: Record<string, unknown>) => publicApiRequest<ApiPage<ApiRankingRow>>(`/v1/public/rankings${query(filters)}`);
export const listMyResults = () => apiRequest<ApiResult[]>(`/v1/clubs/${apiClubId}/match-results`);
export const listClubResults = (status?: string) => apiRequest<ApiResult[]>(`/v1/clubs/${apiClubId}/match-results${query({ mine: false, status })}`);
export const reportResult = (input: ResultInput) => apiRequest<ApiResult>(`/v1/clubs/${apiClubId}/match-results`, { method: "POST", body: JSON.stringify(input) });
export const confirmResult = (id: string) => apiRequest<ApiResult>(`/v1/match-results/${id}/confirm`, { method: "POST" });
export const disputeResult = (id: string, reason: string) => apiRequest<ApiResult>(`/v1/match-results/${id}/dispute`, { method: "POST", body: JSON.stringify({ reason }) });
export const finalizeResult = (id: string, input: { score_text?: string; outcome?: string; winner_side?: 1 | 2; reason: string }) => apiRequest<ApiResult>(`/v1/match-results/${id}/finalize`, { method: "POST", body: JSON.stringify(input) });
export const voidResult = (id: string, reason: string) => apiRequest<ApiResult>(`/v1/match-results/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
