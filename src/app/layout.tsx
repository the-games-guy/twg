import type { Metadata } from "next";
import { getCurrentPlayer } from "@/lib/auth";
import { LogoMark } from "./Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "The World Game",
  description: "Global Predictions League",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const player = await getCurrentPlayer();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="inner">
            <a href="/" className="brand">
              <LogoMark size={24} />
              The World Game
            </a>
            {player && (
              <nav>
                <a href="/predictions">My predictions</a>
                <a href="/leaderboard">Leaderboard</a>
                <a href="/history">History</a>
                {player.isAdmin && <a href="/admin">Admin</a>}
              </nav>
            )}
            {player && (
              <a className="who" href="/account" title="Account settings">
                {player.displayName}
              </a>
            )}
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
