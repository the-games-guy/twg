import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getCurrentPlayer();
  if (!session) redirect("/");

  const player = await prisma.player.findUniqueOrThrow({ where: { id: session.id } });

  return (
    <>
      <h1>Your account</h1>
      <p className="lede">{player.handle} · {player.email}</p>

      <h2>{player.passwordHash ? "Change password" : "Set a password"}</h2>
      <div className="card">
        {!player.passwordHash && (
          <p className="tiny muted" style={{ marginTop: 0 }}>
            You don&apos;t have a password set yet. Setting one here gives
            you a way to sign in directly.
          </p>
        )}
        <ChangePasswordForm hasPassword={Boolean(player.passwordHash)} />
      </div>

      <p className="tiny muted">
        Locked out entirely — forgotten your password? There&apos;s no
        email-based recovery here; ask whoever runs the comp to reset it
        from Admin.
      </p>
    </>
  );
}
