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
export const registerForApiEvent = (eventId: string) => apiRequest(`/v1/events/${eventId}/registrations`, { method: "POST" });
export const listApiNotifications = () => apiRequest<ApiNotification[]>("/v1/notifications");
export const markApiNotificationRead = (notificationId: string) => apiRequest(`/v1/notifications/${notificationId}/read`, { method: "POST" });
