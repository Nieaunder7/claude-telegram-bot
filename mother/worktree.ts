/**
 * Git worktree and child .env management for Mother Bot.
 */

import { resolve } from "path";
import { REPO_ROOT, WORKTREE_BASE } from "./config";

/**
 * Create a git worktree for a new instance.
 * Returns the absolute path to the worktree.
 */
export async function createWorktree(name: string): Promise<string> {
  const worktreePath = resolve(WORKTREE_BASE, name);

  // Ensure base directory exists
  await Bun.$`mkdir -p ${WORKTREE_BASE}`;

  // Create worktree with a named branch
  const result =
    await Bun.$`git -C ${REPO_ROOT} worktree add ${worktreePath} -b mother/${name} HEAD 2>&1`.quiet().nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.text();
    throw new Error(`Failed to create worktree: ${stderr}`);
  }

  return worktreePath;
}

/**
 * Remove a git worktree.
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  await Bun.$`git -C ${REPO_ROOT} worktree remove ${worktreePath} --force 2>&1`.quiet().nothrow();
  await Bun.$`git -C ${REPO_ROOT} worktree prune 2>&1`.quiet().nothrow();

  // Also delete the branch
  const branchName = `mother/${worktreePath.split("/").pop()}`;
  await Bun.$`git -C ${REPO_ROOT} branch -D ${branchName} 2>&1`.quiet().nothrow();
}

/**
 * Write a .env file into a child worktree.
 */
export async function writeChildEnv(
  worktreePath: string,
  env: Record<string, string>
): Promise<void> {
  const lines = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  await Bun.write(resolve(worktreePath, ".env"), lines.join("\n") + "\n");
}

/**
 * Install dependencies in a worktree.
 */
export async function installDeps(worktreePath: string): Promise<void> {
  const result =
    await Bun.$`bun install --cwd ${worktreePath} 2>&1`.quiet().nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.text();
    throw new Error(`bun install failed: ${stderr}`);
  }
}
