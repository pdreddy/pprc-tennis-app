import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import type { Entity } from "@pprc/shared";
export const emulator = import.meta.env.VITE_USE_EMULATORS !== "false";
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-pprc-events",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "demo-pprc-events.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-pprc-events",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "demo-pprc-events.appspot.com",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123:web:demo",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});
export const auth = getAuth(app),
  db = getFirestore(app),
  functions = getFunctions(app, "us-central1"),
  storage = getStorage(app);
if (emulator) {
  const host = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
export const login = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);
export const signup = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);
export const googleLogin = () =>
  signInWithPopup(auth, new GoogleAuthProvider());
function readError(error: unknown) {
  if ((error as { code?: string })?.code === "permission-denied")
    return Object.assign(
      new Error(
        "You do not have permission to view this content. Sign in with an authorized account or ask the club team about access.",
      ),
      { code: "permission-denied" },
    );
  return error;
}
export async function call(
  name: string,
  data: Record<string, unknown> = {},
): Promise<any> {
  const result = await httpsCallable(
    functions,
    name,
  )(JSON.parse(JSON.stringify({ requestId: crypto.randomUUID(), ...data })));
  return result.data;
}
export async function getOne(c: string, id: string): Promise<Entity | null> {
  const s = await getDoc(doc(db, c, id)).catch((error) => {
    throw readError(error);
  });
  return s.exists() ? ({ id: s.id, ...s.data() } as Entity) : null;
}
export async function getList(
  c: string,
  filters: [string, any, any][] = [],
): Promise<Entity[]> {
  const large = filters.find(
    ([, op, v]) => op === "in" && Array.isArray(v) && v.length > 8,
  );
  if (large) {
    const result: Entity[] = [];
    for (let i = 0; i < large[2].length; i += 8) {
      result.push(
        ...(await getList(
          c,
          filters.map((f) =>
            f === large ? [f[0], f[1], f[2].slice(i, i + 8)] : f,
          ),
        )),
      );
    }
    return [...new Map(result.map((r) => [r.id, r])).values()];
  }
  const s = await getDocs(
    query(collection(db, c), ...filters.map(([f, op, v]) => where(f, op, v))),
  ).catch((error) => {
    throw readError(error);
  });
  return s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entity);
}
export async function enablePush() {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey)
    throw Error(
      "Push is not configured for this environment. In-app notifications are active.",
    );
  const { getMessaging, getToken, isSupported } =
    await import("firebase/messaging");
  if (!(await isSupported()))
    throw Error("Push is not supported by this browser");
  const registration = await navigator.serviceWorker.register(
    "/push/firebase-messaging-sw.js",
    { scope: "/push/" },
  );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw Error("Notification permission not granted");
  const token = await getToken(getMessaging(app), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  await call("registerPushToken", { token });
}
