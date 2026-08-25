import { NextResponse } from "next/server";
import { getFacts } from "@/lib/facts";

// Served at runtime, deliberately. The values here used to be NEXT_PUBLIC_*
// constants compiled into the browser bundle, so editing .env and running
// panel-restart — which the Config page tells you to do — changed nothing until
// somebody rebuilt. A fact the panel can measure should never need a rebuild.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getFacts(), {
    headers: { "Cache-Control": "no-store" },
  });
}
