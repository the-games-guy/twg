"use client";

import { useActionState, useEffect, useState } from "react";
import { savePredictionsAction, type SaveState } from "./actions";
import type { SlotView } from "@/lib/predictions";

const INITIAL: SaveState = { ok: true, message: "" };
const TEAMS_DATALIST_ID = "known-teams";

/** All known team names, for the TEAM-slot autocomplete. */
function useKnownTeams(enabled: boolean): string[] {
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data) => {
        if (!cancelled) setTeams(data.teams ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return teams;
}

export function PredictionForm({
  slots,
  values,
  locked,
  changeWindowOpen,
  changesRemaining,
}: {
  slots: SlotView[];
  values: Record<string, string>;
  locked: boolean;
  changeWindowOpen: boolean;
  changesRemaining: number;
}) {
  const [state, action, pending] = useActionState(savePredictionsAction, INITIAL);

  const readOnly = locked && !changeWindowOpen;

  const hasTeamSlots = slots.some((s) => s.valueType === "TEAM");
  const knownTeams = useKnownTeams(hasTeamSlots && !readOnly);

  // Group by competition, preserving the sheet's running order.
  const groups: { name: string; slots: SlotView[] }[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.name === slot.competitionName) last.slots.push(slot);
    else groups.push({ name: slot.competitionName, slots: [slot] });
  }

  return (
    <form action={action}>
      {hasTeamSlots && (
        <datalist id={TEAMS_DATALIST_ID}>
          {knownTeams.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {groups.map((group) => (
        <div className="card" key={`${group.name}-${group.slots[0].id}`}>
          <h2 style={{ marginTop: 0 }}>{group.name}</h2>
          {group.slots.map((slot) => (
            <div className="slot-row" key={slot.id}>
              <label className="slot-label" htmlFor={`slot:${slot.id}`}>
                {slot.label}
                {slot.valueType === "NUMBER" && <small>Number of goals</small>}
                {slot.valueType === "PLAYER" && <small>Player name</small>}
              </label>
              <input
                id={`slot:${slot.id}`}
                name={`slot:${slot.id}`}
                type={slot.valueType === "NUMBER" ? "number" : "text"}
                defaultValue={values[slot.id] ?? ""}
                readOnly={readOnly}
                disabled={readOnly}
                autoComplete="off"
                list={slot.valueType === "TEAM" ? TEAMS_DATALIST_ID : undefined}
                placeholder={
                  readOnly
                    ? ""
                    : slot.valueType === "NUMBER"
                      ? "e.g. 24"
                      : slot.valueType === "TEAM"
                        ? "Start typing a club name"
                        : "Type a name"
                }
              />
            </div>
          ))}
        </div>
      ))}

      {!readOnly && (
        <div className="card">
          <div className="sticky-save">
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save predictions"}
            </button>
            <span className="status">
              {state.message ? (
                <span style={{ color: state.ok ? undefined : "var(--danger)" }}>
                  {state.message}
                </span>
              ) : locked ? (
                `${changesRemaining} change${changesRemaining === 1 ? "" : "s"} remaining`
              ) : (
                "Edit as often as you like until the deadline."
              )}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
