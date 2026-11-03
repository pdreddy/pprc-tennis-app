import { SignIn, SignUp } from "@clerk/react";

/** Emergent-managed sign-in: Google or a one-time code sent by email. */
export default function EmergentSignIn({ mode }: { mode: "in" | "up" }) {
  return (
    <div className="auth-page" data-testid={mode === "in" ? "emergent-signin" : "emergent-signup"}>
      <aside className="auth-aside">
        <p className="eyebrow">PPRC</p>
        <h1>Your PPRC Rating starts with one match.</h1>
        <p>Sign in with Google or a one-time code by email. New players join the club automatically.</p>
      </aside>
      <div className="auth-card">
        {mode === "in" ? (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp />
        ) : (
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
        )}
      </div>
    </div>
  );
}
