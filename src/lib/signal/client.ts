/**
 * signal-cli-rest-api client.
 *
 * Signal has no official bot API. The practical route is a signal-cli instance
 * registered to its own phone number, wrapped in bbernhard/signal-cli-rest-api
 * and run as a sidecar container. The number can be hidden behind a username
 * once registered, so the group only ever sees the bot's handle.
 *
 * Receiving is polled rather than websocket-driven: this bot answers questions
 * and posts a weekly digest, so a few seconds of latency costs nothing and a
 * plain HTTP loop has far fewer ways to fail silently.
 */

export interface IncomingMessage {
  /** Group id when sent in a group, null for a direct message. */
  groupId: string | null;
  sourceUuid: string;
  sourceNumber: string | null;
  text: string;
  timestamp: number;
}

interface Envelope {
  envelope?: {
    source?: string;
    sourceNumber?: string | null;
    sourceUuid?: string;
    timestamp?: number;
    dataMessage?: {
      message?: string | null;
      groupInfo?: { groupId?: string } | null;
    } | null;
  };
}

export class SignalError extends Error {}

function config() {
  const url = process.env.SIGNAL_API_URL;
  const number = process.env.SIGNAL_BOT_NUMBER;
  if (!url || !number) {
    throw new SignalError("SIGNAL_API_URL and SIGNAL_BOT_NUMBER must be set");
  }
  return { url: url.replace(/\/$/, ""), number };
}

export function isSignalConfigured(): boolean {
  return Boolean(process.env.SIGNAL_API_URL && process.env.SIGNAL_BOT_NUMBER);
}

export async function sendMessage(recipient: string, message: string): Promise<void> {
  const { url, number } = config();
  const res = await fetch(`${url}/v2/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, number, recipients: [recipient] }),
  });
  if (!res.ok) {
    throw new SignalError(`send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/** Post to the configured group chat. */
export async function sendToGroup(message: string): Promise<void> {
  const groupId = process.env.SIGNAL_GROUP_ID;
  if (!groupId) throw new SignalError("SIGNAL_GROUP_ID is not set");
  await sendMessage(groupId.startsWith("group.") ? groupId : `group.${groupId}`, message);
}

/**
 * Drain pending messages. signal-cli removes them from the queue once read, so
 * anything returned here will not be returned again.
 */
export async function receiveMessages(timeoutSeconds = 10): Promise<IncomingMessage[]> {
  const { url, number } = config();
  const res = await fetch(
    `${url}/v1/receive/${encodeURIComponent(number)}?timeout=${timeoutSeconds}`,
    { signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000) },
  );
  if (!res.ok) {
    throw new SignalError(`receive failed: ${res.status}`);
  }

  const body = (await res.json()) as Envelope[] | Envelope;
  const envelopes = Array.isArray(body) ? body : [body];

  const out: IncomingMessage[] = [];
  for (const e of envelopes) {
    const env = e.envelope;
    const data = env?.dataMessage;
    if (!env || !data?.message) continue;
    out.push({
      groupId: data.groupInfo?.groupId ?? null,
      sourceUuid: env.sourceUuid ?? "",
      sourceNumber: env.sourceNumber ?? env.source ?? null,
      text: data.message,
      timestamp: env.timestamp ?? Date.now(),
    });
  }
  return out;
}
