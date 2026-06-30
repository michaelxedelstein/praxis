/**
 * Single-user bearer auth for the brain WebSocket + HTTP endpoints. The phone
 * and desktop present `PRAXIS_AUTH_SECRET` on the handshake; unauthenticated
 * connections are rejected. No user system — this is just me.
 */
import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison to avoid leaking the secret via timing. */
export function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Pull the bearer token from a WS/HTTP upgrade request. Accepts either an
 * `Authorization: Bearer <token>` header or a `?token=<token>` query param
 * (browsers/React Native can't always set WS headers, so the query param is the
 * mobile-friendly fallback).
 */
export function extractBearer(req: {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}): string | null {
  const auth = req.headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (req.url) {
    try {
      const u = new URL(req.url, "http://localhost");
      const t = u.searchParams.get("token");
      if (t) return t;
    } catch {
      /* ignore malformed url */
    }
  }
  return null;
}

/** True when the request carries the expected secret. */
export function isAuthorized(
  req: { headers: Record<string, string | string[] | undefined>; url?: string },
  expectedSecret: string,
): boolean {
  if (!expectedSecret) return false;
  const provided = extractBearer(req);
  if (!provided) return false;
  return secretsMatch(provided, expectedSecret);
}
