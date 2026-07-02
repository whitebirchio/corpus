/**
 * Corpus MCP server — Cloudflare Worker entrypoint.
 *
 * OAuthProvider is both the OAuth 2.1 authorization server facing Claude
 * (PKCE + Dynamic Client Registration at /register) and the router: /mcp is
 * token-protected and lands on the McpAgent; everything else falls through to
 * the Google login handler. Data access control is the email allowlist inside
 * that handler + Postgres RLS — an open /register admits no one to any data.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GoogleHandler } from "./auth/google.js";
import { CorpusMcpAgent } from "./mcp.js";

export { CorpusMcpAgent };

export default new OAuthProvider({
  apiRoute: "/mcp",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiHandler: CorpusMcpAgent.serve("/mcp", { binding: "MCP_OBJECT" }) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: GoogleHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
