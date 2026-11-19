import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { D1Database } from "@cloudflare/workers-types";

export interface AuthEnv {
  DB: D1Database;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface MatrixUser {
  userId: string;
  displayName: string;
}

function appOrigin(env: Pick<AuthEnv, "APP_URL">): string {
  const url = new URL(env.APP_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("APP_URL must be the public HTTPS origin (HTTP is allowed only on localhost).");
  }
  return url.origin;
}

export function getAuthConfig(env: AuthEnv) {
  return {
    emailPasswordEnabled: true,
    googleReady: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
    minPasswordLength: 12,
    emailVerificationEnabled: false,
    passwordResetEnabled: false,
    recoveryMessage: "Password reset by email is not available yet. Keep your password saved; you can change it while signed in.",
  };
}

/** Create within the Worker request: D1 bindings and auth state are never shared globally. */
export function createAuth(env: AuthEnv) {
  const origin = appOrigin(env);
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("A random BETTER_AUTH_SECRET of at least 32 characters is required.");
  }
  const secure = origin.startsWith("https:");
  const googleReady = getAuthConfig(env).googleReady;

  return betterAuth({
    appName: "Matrix",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (["/sign-up/email", "/update-user"].includes(context.path) && context.body?.name !== undefined) {
          const name = context.body.name;
          if (typeof name !== "string" || !name.trim() || name.length > 100) {
            throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "Choose a name between 1 and 100 characters." });
          }
          return { context: { body: { ...context.body, name: name.trim() } } };
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      // No mail service is configured. Do not claim to send verification or reset emails.
      // Better Auth rejects request-password-reset without sendResetPassword.
    },
    socialProviders: googleReady ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        prompt: "select_account",
      },
    } : {},
    user: {
      modelName: "auth_user",
      changeEmail: { enabled: false },
      validateUserInfo: ({ user, source }) => {
        if (source.oauth?.providerId === "google" && user.emailVerified !== true) {
          return { error: "EMAIL_NOT_VERIFIED", errorDescription: "Use a Google account with a verified email address." };
        }
        if (typeof user.name === "string" && (!user.name.trim() || user.name.length > 100)) {
          return { error: "INVALID_NAME", errorDescription: "Choose a name between 1 and 100 characters." };
        }
      },
    },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_account",
      // Matching email text alone never grants ownership of another account.
      accountLinking: { enabled: false, disableImplicitLinking: true },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      storeAccountCookie: false,
    },
    verification: {
      modelName: "auth_verification",
      storeInDatabase: true,
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 15, max: 5 },
        "/sign-in/social": { window: 60, max: 10 },
        "/change-password": { window: 60 * 15, max: 5 },
        "/request-password-reset": { window: 60 * 15, max: 3 },
        "/reset-password": { window: 60 * 15, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "matrix",
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      // Cloudflare replaces this header at the edge. Ignore spoofable X-Forwarded-For.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      trustedProxyHeaders: false,
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
  });
}

/** Only a valid, unexpired database-backed session establishes an owner. */
export async function getUser(request: Request, env: AuthEnv): Promise<MatrixUser | null> {
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return { userId: session.user.id, displayName: session.user.name.trim() || "Learner" };
}
