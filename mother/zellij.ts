/**
 * Zellij session management for Mother Bot.
 */

/**
 * Start a new Zellij session running the bot.
 * Uses `script` to allocate a pseudo-TTY since Zellij needs one.
 */
export async function startSession(
  sessionName: string,
  cwd: string
): Promise<void> {
  const proc = Bun.spawn(
    [
      "setsid",
      "script",
      "-qefc",
      `exec zellij --session ${sessionName} -- bun run start`,
      "/dev/null",
    ],
    {
      cwd,
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }
  );
  proc.unref();

  // Wait and verify session started
  await Bun.sleep(3000);
  const alive = await isSessionAlive(sessionName);
  if (!alive) {
    throw new Error(`Zellij session failed to start: ${sessionName}`);
  }
}

/**
 * Kill a Zellij session.
 */
export async function killSession(sessionName: string): Promise<boolean> {
  const result =
    await Bun.$`zellij kill-session ${sessionName} 2>&1`.quiet().nothrow();
  return result.exitCode === 0;
}

/**
 * Check if a Zellij session is alive.
 */
export async function isSessionAlive(sessionName: string): Promise<boolean> {
  const sessions = await listSessions();
  return sessions.get(sessionName) === "running";
}

/**
 * List all Zellij sessions with their status.
 */
export async function listSessions(): Promise<
  Map<string, "running" | "exited">
> {
  const result =
    await Bun.$`zellij list-sessions 2>&1`.quiet().nothrow();
  const text = result.text();

  const sessions = new Map<string, "running" | "exited">();
  for (const line of text.split("\n")) {
    // Strip ANSI escape codes
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!stripped) continue;

    const match = stripped.match(/^(\S+)\s+/);
    if (match) {
      const name = match[1]!;
      const isExited = stripped.includes("EXITED");
      sessions.set(name, isExited ? "exited" : "running");
    }
  }
  return sessions;
}
