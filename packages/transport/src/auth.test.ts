import { describe, it, expect } from "vitest";
import { extractBearer, isAuthorized, secretsMatch } from "./auth.js";

describe("auth", () => {
  it("matches equal secrets and rejects unequal ones", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });

  it("extracts a bearer token from the Authorization header", () => {
    expect(extractBearer({ headers: { authorization: "Bearer xyz" } })).toBe("xyz");
  });

  it("falls back to a ?token= query param", () => {
    expect(extractBearer({ headers: {}, url: "/ws?token=qwe" })).toBe("qwe");
  });

  it("authorizes only with the exact secret", () => {
    const req = { headers: { authorization: "Bearer s3cret" } };
    expect(isAuthorized(req, "s3cret")).toBe(true);
    expect(isAuthorized(req, "nope")).toBe(false);
    expect(isAuthorized({ headers: {} }, "s3cret")).toBe(false);
  });
});
