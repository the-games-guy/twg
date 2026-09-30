"use server";

import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth";
import {
  PredictionInvalidError,
  PredictionLockedError,
  getActiveSeason,
  savePredictions,
} from "@/lib/predictions";

export interface SaveState {
  ok: boolean;
  message: string;
}

export async function savePredictionsAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const player = await requirePlayer();
  const season = await getActiveSeason();
  if (!season) return { ok: false, message: "No active season." };

  // Field names are slot ids; blanks are skipped so a partially filled form is
  // a valid save rather than an error.
  const values = new Map<string, string>();
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("slot:")) continue;
    const value = String(raw).trim();
    if (!value) continue;
    values.set(key.slice(5), value);
  }

  try {
    const result = await savePredictions(season.id, player.id, values, new Date());
    revalidatePath("/predictions");

    if (result.saved === 0) return { ok: true, message: "Nothing changed." };
    if (season.isLocked) {
      return {
        ok: true,
        message:
          `Saved ${result.saved} pick${result.saved === 1 ? "" : "s"}. ` +
          `${result.changesRemaining} of your ${season.changeBudget} changes remain.`,
      };
    }
    return {
      ok: true,
      message: `Saved ${result.saved} pick${result.saved === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    if (e instanceof PredictionLockedError) return { ok: false, message: e.message };
    if (e instanceof PredictionInvalidError) return { ok: false, message: e.message };
    throw e;
  }
}
