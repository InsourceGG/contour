import "server-only";
import type { ContourServerConfig } from "./config";

/**
 * Internal per-server context shared by the OAuth, MCP, store and host
 * modules. Every value is derived from the config at call time, so config
 * getters (for example an `appUrl` read from the environment) stay live.
 */
export type ServerContext = {
  cfg: ContourServerConfig;
  /** Service-role client bound to the configured schema. */
  db(): ReturnType<ContourServerConfig["db"]["schema"]>;
  /** OAuth issuer identifier (RFC 8414): the deployment origin, no trailing slash. */
  issuer(): string;
  /** The single protected resource (RFC 8707 / RFC 9728 canonical URI). */
  mcpResource(): string;
  /** Path-inserted RFC 9728 metadata URL for the MCP resource. */
  resourceMetadataUrl(): string;
  /** The surface used for host sessions and the MCP connection check. */
  defaultSurface(): string;
};

export function createServerContext(cfg: ContourServerConfig): ServerContext {
  const issuer = () => cfg.appUrl.replace(/\/$/, "");
  const mcpResource = () => `${issuer()}/api/mcp`;
  return {
    cfg,
    db: () => cfg.db.schema(cfg.schema),
    issuer,
    mcpResource,
    resourceMetadataUrl: () => {
      const r = new URL(mcpResource());
      return `${r.origin}/.well-known/oauth-protected-resource${r.pathname === "/" ? "" : r.pathname}`;
    },
    defaultSurface: () => {
      const s = cfg.surfaces[0];
      if (!s) throw new Error("ContourServerConfig.surfaces must list at least one surface");
      return s;
    },
  };
}
