import { uuidv7 } from "@discvault/sync-protocol";
import { betterAuth } from "better-auth";
import { decideSignup, provisionVault } from "../directory/directory.js";
import type { Env } from "../env.js";

export const AUTH_BASE_PATH = "/api/auth";

/**
 * Google is the only sign-in method (§3.3). A user is identified by Google's `sub` (Better Auth's
 * account.accountId), and gets one personal vault created together with the user.
 */
export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.PUBLIC_ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DIRECTORY,
    trustedOrigins: [env.PUBLIC_ORIGIN],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
      },
    },
    account: {
      // The app never calls Google APIs; tokens are kept encrypted only because Better Auth stores them.
      encryptOAuthTokens: true,
    },
    user: {
      additionalFields: {
        vaultId: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: 90 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // Signed cookie cache: most requests don't read D1. Revocations apply within 5 minutes.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: "uuid" },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const decision = await decideSignup(env, user.email, user.emailVerified);
            if (!decision.ok) return false;
            return { data: { ...user, vaultId: uuidv7() } };
          },
          after: async (user) => {
            await provisionVault(env, user.id, String(user.vaultId), user.email);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
