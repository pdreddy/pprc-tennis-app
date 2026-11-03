import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/react";
import { setExternalSession } from "../external-auth";

// PPRC brand on Clerk's sign-in card and user menu.
const appearance = {
  variables: {
    colorPrimary: "#102c43",
    colorPrimaryForeground: "#ffffff",
    colorForeground: "#0b1f30",
    borderRadius: "12px",
    fontFamily: "Manrope, sans-serif",
  },
};

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

type ClerkConfig = { enabled: boolean; publishable_key: string; proxy_url: string };

// Starts Clerk from the backend's runtime config, so deploy's live keys need no rebuild.
export default function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const cfg = (await (await fetch(`${API_BASE}/clerk/config`)).json()) as ClerkConfig;
        if (cfg.enabled) return cancelled || setConfig(cfg);
      } catch {
        /* backend restarting; retry below */
      }
      if (cancelled) return;
      if (attempt >= 20) return setUnavailable(true);
      setTimeout(() => load(attempt + 1), 1500);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable) return <p style={{ padding: 24 }}>Sign-in is unavailable right now. Refresh the page to try again.</p>;
  if (!config) return null;
  return (
    <ClerkProvider
      publishableKey={config.publishable_key}
      proxyUrl={config.proxy_url || undefined}
      appearance={appearance}
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/me/rating"
      signUpFallbackRedirectUrl="/me/rating"
      afterSignOutUrl="/"
    >
      <ClerkBridge />
      {children}
    </ClerkProvider>
  );
}

/** Pushes the Clerk session into the app's SessionProvider and API client. */
function ClerkBridge() {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const clerk = useClerk();
  useEffect(() => {
    if (!isLoaded) return;
    setExternalSession(
      user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? null, name: user.fullName || user.primaryEmailAddress?.emailAddress?.split("@")[0] || null } : null,
      () => getToken(),
      () => clerk.signOut(),
    );
  }, [isLoaded, user, getToken, clerk]);
  return null;
}
