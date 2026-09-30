"use server";

import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPasswordHash } from "@/lib/password";

export interface ChangePasswordState {
  ok: boolean;
  message: string;
}

/**
 * The self-service side of password recovery. There's no email to send a
 * reset link through, so this is what "reset your password" means here: if
 * you can get in at all — via Google, or your current password — you can set
 * a new one yourself, without asking the admin.
 *
 * If you can't get in at all (no Google linked, forgot your only password),
 * the admin resetting it for you in Admin → Registration is still the way
 * out. That was already true before this existed.
 */
export async function changeMyPasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await requirePlayer();
  const player = await prisma.player.findUniqueOrThrow({ where: { id: session.id } });

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Only demand the current password if one is already set — a player who
  // got here via Google and has never had a password isn't proving anything
  // by typing one that doesn't exist.
  if (player.passwordHash) {
    if (!currentPassword || !verifyPasswordHash(currentPassword, player.passwordHash)) {
      return { ok: false, message: "Current password is incorrect." };
    }
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "New password and confirmation don't match." };
  }

  await prisma.player.update({
    where: { id: player.id },
    data: { passwordHash: hashPassword(newPassword), failedLoginAttempts: 0, lockedUntil: null },
  });

  revalidatePath("/account");
  return { ok: true, message: player.passwordHash ? "Password changed." : "Password set." };
}
