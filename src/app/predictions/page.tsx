import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import {
  countChanges,
  getActiveSeason,
  getEntryProgress,
  getOwnPredictions,
  getSlots,
} from "@/lib/predictions";
import { PredictionForm } from "./PredictionForm";

export const dynamic = "force-dynamic";

function formatDeadline(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: process.env.APP_TIMEZONE || "UTC",
  });
}

export default async function PredictionsPage() {
  const player = await getCurrentPlayer();
  if (!player) redirect("/");

  const season = await getActiveSeason();
  if (!season) {
    return (
      <>
        <h1>No active season</h1>
        <p className="lede">Nothing is open for predictions right now.</p>
      </>
    );
  }

  const [slots, values, changesUsed, progress] = await Promise.all([
    getSlots(season.id),
    getOwnPredictions(season.id, player.id),
    countChanges(season.id, player.id),
    getEntryProgress(season.id),
  ]);

  const mine = progress.find((p) => p.playerId === player.id);
  const entered = mine?.entered ?? 0;
  const changesRemaining = season.changeBudget - changesUsed;

  return (
    <>
      <h1>{season.label} predictions</h1>
      <p className="lede">
        {entered} of {slots.length} entered.
      </p>

      {!season.isLocked && (
        <div className="notice">
          Only you can see these. Everyone&apos;s picks are revealed together
          {season.predictionDeadline
            ? ` when entry closes on ${formatDeadline(season.predictionDeadline)}.`
            : " when entry closes."}
        </div>
      )}

      {season.isLocked && season.changeWindowOpen && (
        <div className="notice warn">
          The change window is open. You have {changesRemaining} of{" "}
          {season.changeBudget} changes left. Swapping two of your own picks
          counts as one.
        </div>
      )}

      {season.isLocked && !season.changeWindowOpen && (
        <div className="notice">
          Predictions are locked for the season.
          {season.changeWindowStart && season.changeWindowStart > new Date()
            ? ` You can make ${season.changeBudget} changes during the window in January.`
            : ""}
        </div>
      )}

      <PredictionForm
        slots={slots}
        values={Object.fromEntries(values)}
        locked={season.isLocked}
        changeWindowOpen={season.changeWindowOpen}
        changesRemaining={changesRemaining}
      />

      <h2>Who&apos;s in</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Player</th><th className="num">Entered</th></tr>
          </thead>
          <tbody>
            {progress.map((p) => (
              <tr key={p.playerId}>
                <td>{p.handle}{p.playerId === player.id ? " (you)" : ""}</td>
                <td className="num">{p.entered} / {p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Counts only — nobody&apos;s picks are visible until the deadline.
        </p>
      </div>
    </>
  );
}
