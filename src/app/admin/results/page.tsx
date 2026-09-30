import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveManualResultAction } from "../actions";
import { ActionForm, Field } from "../AdminForms";
import type { CupStagePayload, StandingsPayload } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const player = await getCurrentPlayer();
  if (!player) redirect("/");
  if (!player.isAdmin) {
    return (<><h1>Results</h1><div className="notice error">You are not an admin.</div></>);
  }

  const season = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startYear: "desc" },
    include: {
      competitions: {
        include: { competition: true, results: true, slots: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
  if (!season) return (<><h1>Results</h1><p className="lede">No active season.</p></>);

  const manualCups = season.competitions.filter(
    (sc) => !sc.competition.providerCode &&
      sc.slots.some((s) => s.kind === "CUP_WINNER" || s.kind === "CUP_SEMI_FINALIST"),
  );
  const playoffLeagues = season.competitions.filter((sc) =>
    sc.slots.some((s) => s.kind === "PROMOTION"),
  );

  return (
    <>
      <h1>Results · {season.label}</h1>
      <p className="lede">
        Everything football-data.org cannot serve on the free tier.
      </p>

      {playoffLeagues.length > 0 && <h2>Play-off winners</h2>}
      {playoffLeagues.map((sc) => {
        const standings = sc.results.find((r) => r.kind === "STANDINGS");
        const payload = standings ? (JSON.parse(standings.payload) as StandingsPayload) : null;
        return (
          <div className="card" key={sc.id}>
            <strong>{sc.competition.name}</strong>
            <p className="tiny muted" style={{ marginTop: "0.2rem" }}>
              The third promoted club. Not in any API table, so it must be
              entered here — until it is, promotion picks stay undecided rather
              than scoring zero.
            </p>
            <ActionForm action={saveManualResultAction} submitLabel="Save play-off winner">
              <input type="hidden" name="seasonCompetitionId" value={sc.id} />
              <input type="hidden" name="kind" value="PLAYOFF" />
              <Field label="Play-off winner">
                <input type="text" name="playoffWinner" defaultValue={payload?.playoffWinner ?? ""} placeholder="Club name" />
              </Field>
            </ActionForm>
            {!standings && (
              <p className="tiny" style={{ color: "var(--danger)" }}>
                Run a results sync first so there is a table to attach this to.
              </p>
            )}
          </div>
        );
      })}

      <h2>Cups</h2>
      {manualCups.length === 0 && <div className="card">No manual cups this season.</div>}
      {manualCups.map((sc) => {
        const row = sc.results.find((r) => r.kind === "CUP_STAGE");
        const payload = row ? (JSON.parse(row.payload) as CupStagePayload) : null;
        const sf = payload?.semiFinalists ?? [];
        return (
          <div className="card" key={sc.id}>
            <strong>{sc.competition.name}</strong>{" "}
            {row && <span className="pill pending">{row.status.toLowerCase()}</span>}
            <p className="tiny muted" style={{ marginTop: "0.2rem" }}>
              Enter the semi-finalists as soon as they are known — that alone
              scores points, and the leaderboard updates without waiting for the
              final.
            </p>
            <ActionForm action={saveManualResultAction} submitLabel="Save">
              <input type="hidden" name="seasonCompetitionId" value={sc.id} />
              <input type="hidden" name="kind" value="CUP_STAGE" />
              <Field label="Winner">
                <input type="text" name="winner" defaultValue={payload?.winner ?? ""} />
              </Field>
              <Field label="Runner-up">
                <input type="text" name="runnerUp" defaultValue={payload?.runnerUp ?? ""} />
              </Field>
              {[1, 2, 3, 4].map((i) => (
                <Field key={i} label={`Semi-finalist ${i}`}>
                  <input type="text" name={`sf${i}`} defaultValue={sf[i - 1] ?? ""} />
                </Field>
              ))}
              <Field label="Eliminated before the semis">
                <input
                  type="text"
                  name="eliminated"
                  defaultValue={(payload?.eliminated ?? []).join(", ")}
                  placeholder="Comma-separated club names"
                />
              </Field>
              <p className="tiny muted" style={{ marginTop: "-0.4rem" }}>
                Add a club here the round it goes out — picks on it drop to 0
                straight away instead of sitting undecided until the final.
              </p>
              <label className="tiny muted">
                <input type="checkbox" name="final" defaultChecked={row?.status === "FINAL"} />{" "}
                competition is finished
              </label>
            </ActionForm>
          </div>
        );
      })}
    </>
  );
}
