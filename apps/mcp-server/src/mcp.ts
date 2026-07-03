import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";
import type { GrantProps } from "./types.js";

/**
 * One Durable Object instance per MCP session (Streamable HTTP transport).
 * OAuth props from the grant arrive as this.props (specs/01-initial-platform/SPEC.md §7).
 */
export class CorpusMcpAgent extends McpAgent<Env, unknown, GrantProps> {
  server = new McpServer({ name: "Corpus", version: "0.1.0" });

  async init(): Promise<void> {
    registerTools(this.server, this.env, () => {
      const props = this.props;
      if (!props?.userId) {
        throw new Error("Not authenticated — no grant props on this session");
      }
      return props;
    });
    // Prompts are static workflow scaffolds — no auth/data access needed.
    registerPrompts(this.server);
  }
}
