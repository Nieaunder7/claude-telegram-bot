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
  // Clean up stale EXITED session with the same name
  const existingSessions = await listSessions();
  if (existingSessions.has(sessionName)) {
    const status = existingSessions.get(sessionName);
    if (status === "exited") {
      await Bun.$`zellij delete-session ${sessionName} 2>&1`.quiet().nothrow();
    } else {
      throw new Error(
        `Zellij session "${sessionName}" is already running. Use /stop first.`
      );
    }
  }

  // Verify cwd exists
  const cwdExists =
    await Bun.$`test -d ${cwd}`.quiet().nothrow();
  if (cwdExists.exitCode !== 0) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  // Verify .env exists in cwd
  const envExists =
    await Bun.$`test -f ${cwd}/.env`.quiet().nothrow();
  if (envExists.exitCode !== 0) {
    throw new Error(`No .env file found in worktree: ${cwd}/.env`);
  }

  // Log file for capturing startup errors
  const logFile = `/tmp/mother-spawn-${sessionName}.log`;

  const proc = Bun.spawn(
    [
      "setsid",
      "script",
      "-qefc",
      `exec zellij --session ${sessionName} -- bun run start`,
      logFile,
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
    // Read the log for details
    let details = "";
    try {
      const logContent = await Bun.file(logFile).text();
      const stripped = logContent.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (stripped) {
        details = `\n\nStartup log (${logFile}):\n${stripped.slice(-500)}`;
      }
    } catch {}

    // Also check zellij list-sessions output
    const sessionsResult =
      await Bun.$`zellij list-sessions 2>&1`.quiet().nothrow();
    const sessionsText = sessionsResult.text().replace(/\x1b\[[0-9;]*m/g, "").trim();

    throw new Error(
      `Zellij session failed to start: ${sessionName}\n` +
      `cwd: ${cwd}\n` +
      `Zellij sessions: ${sessionsText || "(none)"}` +
      details
    );
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
