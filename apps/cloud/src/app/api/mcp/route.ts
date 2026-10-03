import { methodNotAllowed } from "@contour/sdk/server";
import { contour } from "@/server/contour";
import { env } from "@/server/env";
import { cloudDb } from "@/server/db";
import { cloudTools } from "@/server/tools";
import { clientIdFor } from "@/server/project-client";
import { pinnedFetchJson } from "@/server/pinned-fetch";
import { adaptCloudTools, CLOUD_MCP_INSTRUCTIONS } from "@/server/mcp-adapter";

export const dynamic = "force-dynamic";
let handler: ((request: Request) => Promise<Response>) | null = null;

export async function POST(request: Request) {
  handler ??= contour.mcp({
    tools: adaptCloudTools(cloudTools({
      db: cloudDb(), fetchJson: pinnedFetchJson, appUrl: env.appUrl,
      clientId: `${env.appUrl}/oauth/client.json`, clientIdFor: (project) => clientIdFor(project),
    })),
    instructions: CLOUD_MCP_INSTRUCTIONS,
  });
  return handler(request);
}

export function GET() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }
