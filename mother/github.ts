/**
 * GitHub integration helpers for Mother Bot.
 * Uses `gh` CLI for issue fetching and repo cloning.
 */

import { resolve } from "path";
import { CLONE_BASE_DIR } from "./config";

// ─── Types ───────────────────────────────────────────────

export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubIssue {
  title: string;
  body: string;
  labels: Array<{ name: string }>;
}

// ─── URL Parsing ─────────────────────────────────────────

/**
 * Parse a GitHub issue URL into its components.
 * Returns null if not a valid GitHub issue URL.
 */
export function parseIssueUrl(url: string): ParsedIssueUrl | null {
  const match = url.match(
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)$/
  );
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: parseInt(match[3]!, 10),
  };
}

// ─── Issue Fetching ──────────────────────────────────────

/**
 * Fetch issue metadata using gh CLI.
 */
export async function fetchIssue(
  owner: string,
  repo: string,
  number: number
): Promise<GitHubIssue> {
  const result =
    await Bun.$`gh issue view ${number} -R ${owner}/${repo} --json title,body,labels`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.text().trim();
    throw new Error(`Failed to fetch issue #${number}: ${stderr}`);
  }

  return JSON.parse(result.text()) as GitHubIssue;
}

// ─── Repo Clone / Pull ──────────────────────────────────

/**
 * Ensure the repository is cloned locally and up to date.
 * Returns the absolute path to the local clone.
 */
export async function ensureRepo(
  owner: string,
  repo: string
): Promise<string> {
  const repoPath = resolve(CLONE_BASE_DIR, repo);

  await Bun.$`mkdir -p ${CLONE_BASE_DIR}`.quiet().nothrow();

  const exists =
    await Bun.$`test -d ${repoPath}/.git`.quiet().nothrow();

  if (exists.exitCode === 0) {
    // Repo exists — pull latest (non-fatal on failure)
    const pullResult =
      await Bun.$`git -C ${repoPath} pull --ff-only 2>&1`.quiet().nothrow();
    if (pullResult.exitCode !== 0) {
      console.warn(`git pull warning in ${repoPath}: ${pullResult.text()}`);
    }
  } else {
    // Clone fresh
    const cloneResult =
      await Bun.$`gh repo clone ${owner}/${repo} ${repoPath} 2>&1`
        .quiet()
        .nothrow();
    if (cloneResult.exitCode !== 0) {
      throw new Error(
        `Failed to clone ${owner}/${repo}: ${cloneResult.text().trim()}`
      );
    }
  }

  return repoPath;
}

// ─── Branch Creation ─────────────────────────────────────

/**
 * Create a feature branch `issue-<number>` from the default branch.
 * If the branch already exists (local or remote), checks it out.
 */
export async function createIssueBranch(
  repoPath: string,
  issueNumber: number
): Promise<string> {
  const branchName = `issue-${issueNumber}`;

  // Fetch all remote refs
  await Bun.$`git -C ${repoPath} fetch --all 2>&1`.quiet().nothrow();

  // Determine default branch
  let defaultBranch = "main";
  const headRef =
    await Bun.$`git -C ${repoPath} symbolic-ref refs/remotes/origin/HEAD 2>&1`
      .quiet()
      .nothrow();
  if (headRef.exitCode === 0) {
    defaultBranch = headRef.text().trim().replace("refs/remotes/origin/", "");
  }

  // Check local branch
  const localCheck =
    await Bun.$`git -C ${repoPath} rev-parse --verify refs/heads/${branchName} 2>&1`
      .quiet()
      .nothrow();

  // Check remote branch
  const remoteCheck =
    await Bun.$`git -C ${repoPath} rev-parse --verify refs/remotes/origin/${branchName} 2>&1`
      .quiet()
      .nothrow();

  if (localCheck.exitCode === 0) {
    await Bun.$`git -C ${repoPath} checkout ${branchName} 2>&1`
      .quiet()
      .nothrow();
  } else if (remoteCheck.exitCode === 0) {
    const result =
      await Bun.$`git -C ${repoPath} checkout -b ${branchName} origin/${branchName} 2>&1`
        .quiet()
        .nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to checkout remote branch ${branchName}: ${result.text().trim()}`
      );
    }
  } else {
    const result =
      await Bun.$`git -C ${repoPath} checkout -b ${branchName} origin/${defaultBranch} 2>&1`
        .quiet()
        .nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create branch ${branchName}: ${result.text().trim()}`
      );
    }
  }

  return branchName;
}

// ─── Message Formatting ─────────────────────────────────

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format issue context for the Telegram success message (HTML).
 */
export function formatIssueContext(
  issue: GitHubIssue,
  parsed: ParsedIssueUrl
): string {
  const labels =
    issue.labels.length > 0
      ? issue.labels.map((l) => l.name).join(", ")
      : "none";

  const bodyExcerpt = issue.body
    ? issue.body.slice(0, 300) + (issue.body.length > 300 ? "..." : "")
    : "(no description)";

  return (
    `📋 <b>${escapeHtml(issue.title)}</b>\n` +
    `🏷 Labels: ${escapeHtml(labels)}\n` +
    `🔗 ${parsed.owner}/${parsed.repo}#${parsed.number}\n\n` +
    `${escapeHtml(bodyExcerpt)}`
  );
}

/**
 * Format a pre-composed message the user can send to the child bot.
 */
export function formatForwardMessage(
  issue: GitHubIssue,
  parsed: ParsedIssueUrl,
  branchName: string
): string {
  const bodyExcerpt = issue.body
    ? issue.body.slice(0, 500) + (issue.body.length > 500 ? "..." : "")
    : "(no description)";

  return (
    `Work on GitHub issue ${parsed.owner}/${parsed.repo}#${parsed.number}\n\n` +
    `Title: ${issue.title}\n` +
    `Branch: ${branchName}\n` +
    `Labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}\n\n` +
    `Description:\n${bodyExcerpt}\n\n` +
    `Please read the codebase, understand the issue, and implement a fix.`
  );
}
