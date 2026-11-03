import type { User } from "firebase/auth";

/** Preview-only sign-in: picks a seeded demo account and sends it as X-PPRC-User. Never enable in production. */
export const demoAuth = import.meta.env.VITE_AUTH_MODE === "demo";

const KEY = "pprc-demo-user";
const EVENT = "pprc-demo-auth";

export const demoAccounts = [
  { uid: "admin", name: "Club Administrator", role: "Club admin" },
  ...Array.from({ length: 16 }, (_, i) => ({ uid: `player${i + 1}`, name: `Demo Player ${i + 1}`, role: "Club member" })),
  { uid: "visitor", name: "New Visitor", role: "Not a member yet" },
];

export function currentDemoUser(): User | null {
  const uid = localStorage.getItem(KEY);
  const account = demoAccounts.find((a) => a.uid === uid);
  if (!account) return null;
  return {
    uid: account.uid,
    email: `${account.uid}@pprc.test`,
    displayName: account.name,
    getIdToken: async () => "",
  } as unknown as User;
}

export function demoSignIn(uid: string) {
  localStorage.setItem(KEY, uid);
  window.dispatchEvent(new Event(EVENT));
}

export function demoSignOut() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function onDemoAuth(callback: (user: User | null) => void) {
  const handler = () => callback(currentDemoUser());
  handler();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
