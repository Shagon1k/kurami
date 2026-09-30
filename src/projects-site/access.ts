import { createPublicKey, verify, type JsonWebKeyInput } from "node:crypto";
import type { IncomingMessage } from "node:http";

type AccessKey = JsonWebKeyInput["key"] & { kid: string };
type AccessOptions = { team: string; audience: string; ownerEmail: string; fetchKeys?: typeof fetch; now?: () => number };

/** Validates the signed assertion and the owner's identity before serving private data. */
export class ProjectsAccess {
  private keys: { at: number; values: AccessKey[] } | null = null;
  private fetching: Promise<void> | null = null;
  private options: AccessOptions;
  constructor(options: AccessOptions) { this.options = options; }

  private async refreshKeys(now: number): Promise<void> {
    if (this.fetching) return this.fetching;
    this.fetching = (async () => {
      const response = await (this.options.fetchKeys ?? fetch)(`${this.options.team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5_000), redirect: "error" });
      if (!response.ok) throw new Error("Access keys unavailable");
      const raw = await response.text();
      if (raw.length > 65_536) throw new Error("Access key response too large");
      const body = JSON.parse(raw) as { keys?: AccessKey[] };
      if (!Array.isArray(body.keys) || body.keys.length > 16) throw new Error("Invalid Access keys");
      this.keys = { at: now, values: body.keys.filter(key => key && typeof key.kid === "string" && key.kty === "RSA") };
    })();
    try { await this.fetching; } finally { this.fetching = null; }
  }

  async authorize(request: Pick<IncomingMessage, "headers">): Promise<string | null> {
    const { team, audience, ownerEmail } = this.options;
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !audience || !ownerEmail) return null;
    const token = request.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length > 16_000) return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
      const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
      const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
      const now = (this.options.now ?? Date.now)();
      if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit || claims.iss !== team || claims.type !== "app" ||
        !Array.isArray(claims.aud) || !claims.aud.includes(audience) || !Number.isFinite(claims.exp) || claims.exp <= now / 1_000 ||
        !Number.isFinite(claims.nbf) || claims.nbf > now / 1_000 || typeof claims.sub !== "string" || !claims.sub ||
        typeof claims.email !== "string" || claims.email.toLowerCase() !== ownerEmail.toLowerCase()) return null;
      if (!this.keys || now - this.keys.at >= 3_600_000) await this.refreshKeys(now);
      let key = this.keys?.values.find(key => key.kid === header.kid);
      if (!key && this.keys && now - this.keys.at > 60_000) { await this.refreshKeys(now); key = this.keys?.values.find(key => key.kid === header.kid); }
      if (!key || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2]!, "base64url"))) return null;
      return claims.sub;
    } catch { return null; }
  }
}
