import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { PasswordSignInForm } from "./PasswordSignInForm";
import { LogoBanner } from "./Logo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const player = await getCurrentPlayer();
  if (player) redirect("/predictions");

  return (
    <>
      <div style={{ margin: "2rem 0 1.5rem" }}>
        <LogoBanner maxWidth={420} priority />
      </div>

      <h1 style={{ margin: "0 0 0.35rem" }}>Welcome back</h1>
      <p className="lede">
        Good to see you. Sign in below to make your picks for this season.
      </p>

      <div className="card">
        <PasswordSignInForm />
      </div>

      <p className="muted tiny">
        This app is invite-only — there is no self-serve signup. Ask whoever
        runs the comp to register you in Admin if signing in doesn&apos;t
        work.
      </p>
    </>
  );
}
