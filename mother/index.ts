/**
 * Mother Bot - Instance Manager for Claude Telegram Bot
 *
 * Manages multiple child bot instances using git worktrees and Zellij sessions.
 */

import { Bot } from "grammy";
import {
  MOTHER_TOKEN,
  MOTHER_ALLOWED_USERS,
  REPO_ROOT,
  WORKTREE_BASE,
  CLONE_BASE_DIR,
  DEFAULT_ALLOWED_USERS,
  DEFAULT_OPENAI_KEY,
  loadTokenPool,
} from "./config";
import {
  addInstance,
  getAllInstances,
  getAvailableToken,
  getInstance,
  removeInstance,
  updateInstance,
} from "./instances";
import {
  createWorktree,
  installDeps,
  removeWorktree,
  writeChildEnv,
} from "./worktree";
import { isSessionAlive, killSession, listSessions, startSession } from "./zellij";
import {
  parseIssueUrl,
  fetchIssue,
  ensureRepo,
  createIssueBranch,
  formatIssueContext,
  formatForwardMessage,
  escapeHtml,
} from "./github";

const bot = new Bot(MOTHER_TOKEN);

// ============== Auth Middleware ==============

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !MOTHER_ALLOWED_USERS.includes(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }
  await next();
});

// ============== /start [name] ==============

bot.command("start", async (ctx) => {
  const name = (ctx.match as string).trim();

  // No args → welcome message
  if (!name) {
    const pool = loadTokenPool();
    const instances = getAllInstances();
    const running = instances.filter((i) => i.status === "running").length;

    await ctx.reply(
      `🤖 <b>Mother Bot</b> — Instance Manager\n\n` +
        `Instances: ${instances.length} (${running} running)\n` +
        `Token pool: ${pool.tokens.length} total\n\n` +
        `<b>Commands:</b>\n` +
        `/spawn &lt;issue_url&gt; — Create instance from GitHub issue\n` +
        `/stop &lt;name&gt; — Stop instance (keep worktree)\n` +
        `/start &lt;name&gt; — Restart stopped instance\n` +
        `/remove &lt;name&gt; — Remove instance completely\n` +
        `/list — List all instances\n` +
        `/status &lt;name&gt; — Instance details\n` +
        `/tokens — Token pool status`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // With args → restart a stopped instance
  const instance = getInstance(name);
  if (!instance) {
    await ctx.reply(`Instance "${name}" not found.`);
    return;
  }

  if (instance.status === "running") {
    const alive = await isSessionAlive(instance.zellijSession);
    if (alive) {
      await ctx.reply(`Instance "${name}" is already running.`);
      return;
    }
  }

  const statusMsg = await ctx.reply(`⏳ Starting "${name}"...`);

  try {
    await startSession(instance.zellijSession, instance.worktreePath);
    updateInstance(name, { status: "running" });
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `🟢 Instance "${name}" started! Bot: @${instance.botUsername}`
    );
  } catch (error) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ Failed to start "${name}": ${String(error).slice(0, 200)}`
    );
  }
});

// ============== /spawn <github_issue_url> ==============

bot.command("spawn", async (ctx) => {
  const input = (ctx.match as string).trim();
  if (!input) {
    await ctx.reply(
      "Usage: /spawn https://github.com/owner/repo/issues/123"
    );
    return;
  }

  // Parse GitHub issue URL
  const parsed = parseIssueUrl(input);
  if (!parsed) {
    await ctx.reply(
      "Invalid GitHub issue URL.\n\n" +
        "Expected: https://github.com/owner/repo/issues/123"
    );
    return;
  }

  // Auto-generate instance name
  const name = `${parsed.repo}-${parsed.number}`;

  if (getInstance(name)) {
    await ctx.reply(
      `Instance "${name}" already exists. Use /remove first, or /start to restart.`
    );
    return;
  }

  // Get available token (fail fast)
  const pool = loadTokenPool();
  const tokenEntry = getAvailableToken(pool);
  if (!tokenEntry) {
    await ctx.reply(
      "No available bot tokens. Add more to tokens.json or /remove an instance."
    );
    return;
  }

  const statusMsg = await ctx.reply(
    `⏳ Spawning "${name}"...\n\n1/8 Fetching issue...`
  );
  const chatId = ctx.chat!.id;

  const editStatus = async (text: string) => {
    try {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, text, {
        parse_mode: "HTML",
      });
    } catch {
      // ignore edit errors
    }
  };

  try {
    // 1. Fetch issue
    const issue = await fetchIssue(parsed.owner, parsed.repo, parsed.number);

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue: ${escapeHtml(issue.title)}\n` +
        `2/8 Cloning/updating repo...`
    );

    // 2. Clone or update repo
    const repoPath = await ensureRepo(parsed.owner, parsed.repo);

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo: ${repoPath}\n` +
        `3/8 Creating branch...`
    );

    // 3. Create feature branch
    const branchName = await createIssueBranch(repoPath, parsed.number);

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo ready\n` +
        `✅ Branch: ${branchName}\n` +
        `4/8 Resolving bot info...`
    );

    // 4. Resolve child bot
    const childBot = new Bot(tokenEntry.token);
    const childInfo = await childBot.api.getMe();
    const botUsername = childInfo.username;

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo ready\n` +
        `✅ Branch: ${branchName}\n` +
        `✅ Bot: @${botUsername}\n` +
        `5/8 Creating worktree...`
    );

    // 5. Create worktree (bot code copy)
    const worktreePath = await createWorktree(name);

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo ready\n` +
        `✅ Branch: ${branchName}\n` +
        `✅ Bot: @${botUsername}\n` +
        `✅ Worktree created\n` +
        `6/8 Writing config...`
    );

    // 6. Write child .env
    await writeChildEnv(worktreePath, {
      TELEGRAM_BOT_TOKEN: tokenEntry.token,
      TELEGRAM_ALLOWED_USERS: DEFAULT_ALLOWED_USERS,
      CLAUDE_WORKING_DIR: repoPath,
      OPENAI_API_KEY: DEFAULT_OPENAI_KEY,
      AUDIT_LOG_PATH: `/tmp/claude-telegram-audit-${name}.log`,
    });

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo ready\n` +
        `✅ Branch: ${branchName}\n` +
        `✅ Bot: @${botUsername}\n` +
        `✅ Worktree created\n` +
        `✅ Config written\n` +
        `7/8 Installing dependencies...`
    );

    // 7. Install deps
    await installDeps(worktreePath);

    await editStatus(
      `⏳ Spawning "${name}"...\n\n` +
        `✅ Issue fetched\n` +
        `✅ Repo ready\n` +
        `✅ Branch: ${branchName}\n` +
        `✅ Bot: @${botUsername}\n` +
        `✅ Worktree created\n` +
        `✅ Config written\n` +
        `✅ Dependencies installed\n` +
        `8/8 Starting Zellij session...`
    );

    // 8. Start Zellij session
    const zellijSession = `claude-${name}`;
    await startSession(zellijSession, worktreePath);

    // Save instance with issue metadata
    addInstance({
      name,
      worktreePath,
      zellijSession,
      botToken: tokenEntry.token,
      botUsername,
      workingDir: repoPath,
      allowedUsers: DEFAULT_ALLOWED_USERS,
      status: "running",
      createdAt: new Date().toISOString(),
      issueUrl: input,
      issueTitle: issue.title,
      repoOwner: parsed.owner,
      repoName: parsed.repo,
      issueNumber: parsed.number,
    });

    // Success message with issue context
    const issueContext = formatIssueContext(issue, parsed);
    await editStatus(
      `✅ Instance "${name}" spawned!\n\n` +
        `🤖 Bot: @${botUsername}\n` +
        `📁 Dir: <code>${repoPath}</code>\n` +
        `🌿 Branch: <code>${branchName}</code>\n` +
        `🖥 Zellij: ${zellijSession}\n\n` +
        issueContext
    );

    // Send pre-formatted message for the child bot
    const forwardMsg = formatForwardMessage(issue, parsed, branchName);
    await ctx.reply(
      `📨 <b>Send this to @${botUsername}:</b>\n\n` +
        `<code>${escapeHtml(forwardMsg)}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    await editStatus(
      `❌ Failed to spawn "${name}": ${String(error).slice(0, 300)}`
    );
  }
});

// ============== /stop <name> ==============

bot.command("stop", async (ctx) => {
  const name = (ctx.match as string).trim();
  if (!name) {
    await ctx.reply("Usage: /stop <name>");
    return;
  }

  const instance = getInstance(name);
  if (!instance) {
    await ctx.reply(`Instance "${name}" not found.`);
    return;
  }

  if (instance.status === "stopped") {
    await ctx.reply(`Instance "${name}" is already stopped.`);
    return;
  }

  await killSession(instance.zellijSession);
  updateInstance(name, { status: "stopped" });
  await ctx.reply(`🔴 Instance "${name}" stopped. Worktree preserved at:\n<code>${instance.worktreePath}</code>`, {
    parse_mode: "HTML",
  });
});

// ============== /remove <name> ==============

bot.command("remove", async (ctx) => {
  const name = (ctx.match as string).trim();
  if (!name) {
    await ctx.reply("Usage: /remove <name>");
    return;
  }

  const instance = getInstance(name);
  if (!instance) {
    await ctx.reply(`Instance "${name}" not found.`);
    return;
  }

  // Stop if running
  if (instance.status === "running") {
    await killSession(instance.zellijSession);
  }

  // Remove worktree
  try {
    await removeWorktree(instance.worktreePath);
  } catch (error) {
    console.warn(`Worktree removal warning: ${error}`);
  }

  // Remove from store (token automatically freed)
  removeInstance(name);
  await ctx.reply(`🗑 Instance "${name}" removed. Token returned to pool.`);
});

// ============== /list ==============

bot.command("list", async (ctx) => {
  const instances = getAllInstances();
  if (instances.length === 0) {
    await ctx.reply("No instances. Use /spawn to create one.");
    return;
  }

  // Cross-check with Zellij
  const zellijSessions = await listSessions();
  for (const inst of instances) {
    if (inst.status === "running") {
      const alive =
        zellijSessions.get(inst.zellijSession) === "running";
      if (!alive) {
        updateInstance(inst.name, { status: "stopped" });
        inst.status = "stopped";
      }
    }
  }

  const lines = ["📋 <b>Instances</b>\n"];
  for (const inst of instances) {
    const icon = inst.status === "running" ? "🟢" : "🔴";
    const age = formatAge(inst.createdAt);
    lines.push(
      `${icon} <b>${inst.name}</b> → @${inst.botUsername}` +
        (inst.status === "stopped" ? " (stopped)" : "")
    );
    const issueRef = inst.issueNumber ? ` | 📋 #${inst.issueNumber}` : "";
    lines.push(`   📁 <code>${inst.workingDir}</code> | ⏱ ${age}${issueRef}`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

// ============== /status [name] ==============

bot.command("status", async (ctx) => {
  const name = (ctx.match as string).trim();
  if (!name) {
    // Show summary of all
    const instances = getAllInstances();
    if (instances.length === 0) {
      await ctx.reply("No instances.");
      return;
    }

    const zellijSessions = await listSessions();
    const lines = ["📊 <b>Status Overview</b>\n"];
    for (const inst of instances) {
      const zellijAlive =
        zellijSessions.get(inst.zellijSession) === "running";
      const icon = zellijAlive ? "🟢" : "🔴";
      lines.push(`${icon} ${inst.name} — @${inst.botUsername}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    return;
  }

  const instance = getInstance(name);
  if (!instance) {
    await ctx.reply(`Instance "${name}" not found.`);
    return;
  }

  const alive = await isSessionAlive(instance.zellijSession);
  if (instance.status === "running" && !alive) {
    updateInstance(name, { status: "stopped" });
    instance.status = "stopped";
  }

  const icon = instance.status === "running" ? "🟢" : "🔴";
  const age = formatAge(instance.createdAt);

  const issueInfo = instance.issueUrl
    ? `\n📋 Issue: <a href="${instance.issueUrl}">${instance.repoOwner}/${instance.repoName}#${instance.issueNumber}</a>` +
      `\n   ${escapeHtml(instance.issueTitle || "")}`
    : "";

  await ctx.reply(
    `📊 <b>Instance: ${instance.name}</b>\n\n` +
      `${icon} Status: ${instance.status}\n` +
      `🤖 Bot: @${instance.botUsername}\n` +
      `📁 Working dir: <code>${instance.workingDir}</code>\n` +
      `🗂 Worktree: <code>${instance.worktreePath}</code>\n` +
      `🖥 Zellij: ${instance.zellijSession}\n` +
      `⏱ Created: ${age}` +
      issueInfo,
    { parse_mode: "HTML" }
  );
});

// ============== /tokens ==============

bot.command("tokens", async (ctx) => {
  const pool = loadTokenPool();
  if (pool.tokens.length === 0) {
    await ctx.reply("No tokens configured. Create mother/tokens.json from tokens.example.json.");
    return;
  }

  const instances = getAllInstances();
  const tokenToInstance = new Map<string, string>();
  for (const inst of instances) {
    tokenToInstance.set(inst.botToken, inst.name);
  }

  const inUse = pool.tokens.filter((t) => tokenToInstance.has(t.token)).length;
  const lines = [
    `🎫 <b>Token Pool:</b> ${inUse}/${pool.tokens.length} in use\n`,
  ];

  for (const entry of pool.tokens) {
    const instanceName = tokenToInstance.get(entry.token);
    if (instanceName) {
      lines.push(`● ${entry.label} → ${instanceName}`);
    } else {
      lines.push(`○ ${entry.label} — available`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

// ============== Helpers ==============

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============== Error Handler ==============

bot.catch((err) => {
  console.error("Mother Bot error:", err);
});

// ============== Startup ==============

console.log("=".repeat(50));
console.log("Mother Bot - Instance Manager");
console.log("=".repeat(50));
console.log(`Repo root: ${REPO_ROOT}`);
console.log(`Worktree base: ${WORKTREE_BASE}`);
console.log(`Clone base: ${CLONE_BASE_DIR}`);

const botInfo = await bot.api.getMe();
console.log(`Bot started: @${botInfo.username}`);

const pool = loadTokenPool();
console.log(`Token pool: ${pool.tokens.length} tokens`);

const instances = getAllInstances();
console.log(`Instances: ${instances.length}`);

bot.start();
