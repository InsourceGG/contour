import { NextResponse } from "next/server";
import { getBroker } from "@/server/broker";
import { resolveHostContext } from "@/server/context";
import { errorResponse } from "@contour/sdk/server";

export async function GET() {
  try {
    const ctx = await resolveHostContext();
    const snapshot = await getBroker().getSnapshot(ctx);
    return NextResponse.json(
      { revision: snapshot.revision, configHash: snapshot.configHash, source: snapshot.source },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
