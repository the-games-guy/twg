import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEntryProgress, toSeasonState } from "@/lib/predictions";
import {
  setChangeWindowAction,
  setDeadlineAction,
  setEmailAction,
  setPasswordAction,
  syncResultsAction,
} from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ActionForm, Field } from "./AdminForms";

export const dynamic = "force-dynamic";

/** datetime-local wants "YYYY-MM-DDTHH:mm". */
function forInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16) : "";
}

export default async function AdminPage() {
  const player = await getCurrentPlayer();
  if (!player) redirect("/");
  if (!player.isAdmin) {
    return (<><h1>Admin</h1><div className="notice error">You are not an admin.</div></>);
  }

  const season = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startYear: "desc" },
  });
  if (!season) return (<><h1>Admin</h1><p className="lede">No active season.</p></>);

  const state = toSeasonState(season);
  const progress = await getEntryProgress(season.id);
  const players = await prisma.player.findMany({ orderBy: { handle: "asc" } });

  const lastSync = await prisma.actualResult.findFirst({ orderBy: { fetchedAt: "desc" } });

  return (
    <>
      <h1>Admin · {season.label}</h1>
      <p className="lede">
        {state.isLocked ? "Predictions are locked." : "Entry is open."}{" "}
        {state.changeWindowOpen && "The change window is open."}
      </p>

      <h2>Entry deadline</h2>
      <div className="card">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Everyone&apos;s picks stay hidden until this moment, then become
          visible to all and lock. Times are UTC.
        </p>
        <ActionForm action={setDeadlineAction} submitLabel="Save deadline">
          <input type="hidden" name="seasonId" value={season.id} />
          <Field label="Deadline (UTC)">
            <input type="datetime-local" name="deadline" defaultValue={forInput(season.predictionDeadline)} />
          </Field>
        </ActionForm>
      </div>

      <h2>Mid-season changes</h2>
      <div className="card">
        <ActionForm action={setChangeWindowAction} submitLabel="Save window">
          <input type="hidden" name="seasonId" value={season.id} />
          <Field label="Window opens (UTC)">
            <input type="datetime-local" name="start" defaultValue={forInput(season.changeWindowStart)} />
          </Field>
          <Field label="Window closes (UTC)">
            <input type="datetime-local" name="end" defaultValue={forInput(season.changeWindowEnd)} />
          </Field>
          <Field label="Changes allowed" hint="A swap of two of your own picks counts as one.">
            <input type="number" name="budget" min={0} max={20} defaultValue={season.changeBudget} />
          </Field>
        </ActionForm>
      </div>

      <h2>Players</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Player</th><th className="num">Entered</th><th>Email</th><th>Password</th></tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const prog = progress.find((x) => x.playerId === p.id);
              return (
                <tr key={p.id}>
                  <td>{p.handle} <span className="muted tiny">{p.displayName}</span></td>
                  <td className="num">{prog?.entered ?? 0} / {prog?.total ?? 0}</td>
                  <td className="tiny muted">{p.email ?? "not registered"}</td>
                  <td className="tiny muted">
                    {p.passwordHash ? "set" : "not set"}
                    {p.lockedUntil && p.lockedUntil > new Date() && " · locked out"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Registration</h2>
      <div className="notice">
        There is no self-serve signup. A player is let in by entering the
        email registered here together with a password you&apos;ve issued
        below.
      </div>
      {players.map((p) => (
        <div className="card" key={p.id}>
          <strong>{p.handle}</strong>

          <ActionForm action={setEmailAction} submitLabel="Save email">
            <input type="hidden" name="playerId" value={p.id} />
            <Field label="Email" hint="Used for password sign-in.">
              <input
                type="email"
                name="email"
                defaultValue={p.email ?? ""}
                placeholder="name@example.com"
                autoComplete="off"
              />
            </Field>
          </ActionForm>

          <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
            <ActionForm action={setPasswordAction} submitLabel={p.passwordHash ? "Change password" : "Set password"}>
              <input type="hidden" name="playerId" value={p.id} />
              <Field
                label="Password"
                hint={
                  p.passwordHash
                    ? "Leave blank and save to remove password sign-in for this player."
                    : `At least ${MIN_PASSWORD_LENGTH} characters. You'll need to tell them what you set.`
                }
              >
                <input type="password" name="password" autoComplete="new-password" placeholder={p.passwordHash ? "••••••••" : ""} />
              </Field>
            </ActionForm>
          </div>
        </div>
      ))}

      <h2>Results</h2>
      <div className="card">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Pulls tables and top scorers from football-data.org for every
          competition it covers. Cups and European finals are entered by hand on
          the <a href="/admin/results">results page</a>.
          {lastSync && ` Last fetched ${lastSync.fetchedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`}
        </p>
        <ActionForm action={syncResultsAction} submitLabel="Sync results now" />
      </div>
    </>
  );
}
