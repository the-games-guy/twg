import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { buildActiveLeaderboard } from "@/lib/reports/leaderboard";
import { LiveRefresh } from "../LiveRefresh";

export const dynamic = "force-dynamic";

const PILL: Record<string, string> = {
  HIT: "hit", PARTIAL: "partial", MISS: "miss", PENDING: "pending", ACTIVE: "active",
};

export default async function LeaderboardPage() {
  const player = await getCurrentPlayer();
  if (!player) redirect("/");

  const board = await buildActiveLeaderboard();
  if (!board) {
    return (<><h1>Leaderboard</h1><p className="lede">No active season.</p></>);
  }

  if (!board.isLocked) {
    return (
      <>
        <h1>{board.seasonLabel} leaderboard</h1>
        <div className="notice">
          Hidden until entry closes. Showing it now would reveal everyone&apos;s
          picks, which is the thing this app exists to prevent.
        </div>
      </>
    );
  }

  // Every player's `slots` array covers the same competitions/slots in the
  // same order (they're built from one shared CompetitionScoreInput[]) — only
  // the prediction/result differs per player — so derive the grouping once
  // from the first row rather than per player.
  const competitions: { competitionName: string; slots: { slotId: string; slotLabel: string }[] }[] = [];
  for (const s of board.rows[0]?.slots ?? []) {
    let comp = competitions.find((c) => c.competitionName === s.competitionName);
    if (!comp) {
      comp = { competitionName: s.competitionName, slots: [] };
      competitions.push(comp);
    }
    comp.slots.push({ slotId: s.slotId, slotLabel: s.slotLabel });
  }

  return (
    <>
      <LiveRefresh />
      <h1>{board.seasonLabel} leaderboard</h1>
      <p className="lede">
        Live standings, recalculated from results as they come in.{" "}
        <span className="tiny muted">
          Updates automatically — last checked {board.generatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
        </span>
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th>
              <th className="num">Points</th><th className="num">Undecided</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.playerId}>
                <td>{row.rank}</td>
                <td>{row.playerHandle}{row.playerId === player.id ? " (you)" : ""}</td>
                <td className="num"><strong>{row.total}</strong></td>
                <td className="num muted">{row.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.awaiting.length > 0 && (
        <div className="notice warn">
          No results recorded yet for: {board.awaiting.join(", ")}. Points from
          those are still to come.
        </div>
      )}

      {competitions.map(({ competitionName, slots }) => (
        <div className="card" key={competitionName}>
          <h2 style={{ margin: "0 0 0.75rem" }}>{competitionName}</h2>
          <div className="scroll-x">
            <table className="predictions">
              <thead>
                <tr>
                  <th>Slot</th>
                  {board.rows.map((row) => (
                    <th className="player" key={row.playerId}>
                      {row.playerHandle}{row.playerId === player.id ? " (you)" : ""}
                    </th>
                  ))}
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(({ slotId, slotLabel }) => {
                  const cells = board.rows.map((row) => ({
                    handle: row.playerHandle,
                    slot: row.slots.find((s) => s.slotId === slotId),
                  }));

                  // Group identical explanations so a unanimous pick gets one
                  // line of commentary instead of the same sentence repeated
                  // once per player.
                  const groups: { handles: string[]; explanation: string }[] = [];
                  for (const c of cells) {
                    if (!c.slot) continue;
                    const g = groups.find((g) => g.explanation === c.slot!.result.explanation);
                    if (g) g.handles.push(c.handle);
                    else groups.push({ handles: [c.handle], explanation: c.slot.result.explanation });
                  }

                  return (
                    <tr key={slotId}>
                      <td>{slotLabel}</td>
                      {cells.map(({ handle, slot }) => (
                        <td className="player" key={handle}>
                          {slot?.displayPrediction ?? <span className="muted">—</span>}
                          {slot && (
                            <>
                              {" "}
                              <span className={`pill ${PILL[slot.result.status]}`}>{slot.result.points}</span>
                            </>
                          )}
                        </td>
                      ))}
                      <td className="muted tiny summary">
                        {groups.length <= 1
                          ? groups[0]?.explanation
                          : groups.map((g) => `${g.handles.join(", ")}: ${g.explanation}`).join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
