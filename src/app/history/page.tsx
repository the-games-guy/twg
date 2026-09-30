import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Tally { handle: string; seasons: number; tournaments: number; total: number }

export default async function HistoryPage() {
  const player = await getCurrentPlayer();
  if (!player) redirect("/");

  const honours = await prisma.honour.findMany({ orderBy: [{ year: "asc" }, { kind: "asc" }] });

  const tallies = new Map<string, Tally>();
  for (const h of honours) {
    const t = tallies.get(h.winnerName) ?? {
      handle: h.winnerName, seasons: 0, tournaments: 0, total: 0,
    };
    if (h.kind === "SEASON") t.seasons += 1;
    else t.tournaments += 1;
    t.total += 1;
    tallies.set(h.winnerName, t);
  }
  const board = [...tallies.values()].sort(
    (a, b) => b.total - a.total || b.seasons - a.seasons,
  );

  const seasons = honours.filter((h) => h.kind === "SEASON").reverse();
  const tournaments = honours.filter((h) => h.kind === "TOURNAMENT").reverse();

  if (honours.length === 0) {
    return (
      <>
        <h1>History</h1>
        <div className="notice warn">
          Nothing imported yet. Run <code>npm run import:workbook</code> to load
          the honour board and past seasons from the spreadsheet.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Honour board</h1>
      <p className="lede">Every season since 2012/13.</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Seasons</th>
              <th className="num">Tournaments</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {board.map((t) => (
              <tr key={t.handle}>
                <td>{t.handle}</td>
                <td className="num">{t.seasons}</td>
                <td className="num">{t.tournaments}</td>
                <td className="num"><strong>{t.total}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Season winners</h2>
      <div className="card">
        <table>
          <thead><tr><th>Season</th><th>Winner</th></tr></thead>
          <tbody>
            {seasons.map((h) => (
              <tr key={h.id}><td>{h.label}</td><td>{h.winnerName}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Tournament winners</h2>
      <div className="card">
        <table>
          <thead><tr><th>Tournament</th><th>Winner</th></tr></thead>
          <tbody>
            {tournaments.map((h) => (
              <tr key={h.id}><td>{h.label}</td><td>{h.winnerName}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
