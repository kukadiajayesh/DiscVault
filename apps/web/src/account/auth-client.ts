import { createAuthClient } from "better-auth/react";

/** Google is the only sign-in method (§3.3); the server rejects any other provider. */
export const authClient = createAuthClient({ basePath: "/api/auth" });

export function signInWithGoogle(callbackURL = "/"): Promise<unknown> {
  return authClient.signIn.social({ provider: "google", callbackURL });
}

export function signOut(): Promise<unknown> {
  return authClient.signOut();
}
