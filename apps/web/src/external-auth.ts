import type { User } from "firebase/auth";

/** Emergent-managed sign-in (Clerk) bridged into the app's session; Clerk hooks live in ClerkBridge. */
export const emergentAuth = import.meta.env.VITE_AUTH_MODE === "emergent";

let current: User | null = null;
let ready = false;
let tokenGetter: () => Promise<string | null> = async () => null;
let signOutFn: () => Promise<void> = async () => {};
const listeners = new Set<(user: User | null) => void>();

export function setExternalSession(user: { id: string; email: string | null; name: string | null } | null, getToken: () => Promise<string | null>, signOut: () => Promise<void>) {
  const changed = !ready || (current?.uid ?? null) !== (user?.id ?? null);
  ready = true;
  tokenGetter = getToken;
  signOutFn = signOut;
  current = user
    ? ({ uid: user.id, email: user.email, displayName: user.name, photoURL: null, getIdToken: async () => (await getToken()) ?? "" } as unknown as User)
    : null;
  if (changed) listeners.forEach((listener) => listener(current));
}

export const getExternalToken = () => tokenGetter();
export const externalSignOut = () => signOutFn();

export function onExternalAuth(callback: (user: User | null) => void) {
  listeners.add(callback);
  if (ready) callback(current);
  return () => listeners.delete(callback);
}
