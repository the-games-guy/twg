import { NextResponse } from "next/server";
import { startGoogleSignIn } from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = await startGoogleSignIn();
  return NextResponse.redirect(url);
}
