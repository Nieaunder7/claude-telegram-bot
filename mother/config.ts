/**
 * Configuration for Mother Bot.
 */

import { resolve, dirname } from "path";
import type { TokenPoolConfig } from "./types";

// ============== Load mother/.env ==============

const MOTHER_DIR = dirname(import.meta.filename);

const envPath = resolve(MOTHER_DIR, ".env");
const envFile = Bun.file(envPath);
if (await envFile.exists()) {
  const envText = await envFile.text();
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// ============== Core Configuration ==============

export const MOTHER_TOKEN = process.env.MOTHER_BOT_TOKEN || "";
export const MOTHER_ALLOWED_USERS: number[] = (
  process.env.MOTHER_ALLOWED_USERS || ""
)
  .split(",")
  .filter((x) => x.trim())
  .map((x) => parseInt(x.trim(), 10))
  .filter((x) => !isNaN(x));

export const DEFAULT_ALLOWED_USERS =
  process.env.DEFAULT_ALLOWED_USERS || process.env.MOTHER_ALLOWED_USERS || "";
export const DEFAULT_OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// ============== Paths ==============

export const REPO_ROOT = resolve(MOTHER_DIR, "..");
export const WORKTREE_BASE = resolve(MOTHER_DIR, "worktrees");
export const INSTANCES_FILE = resolve(MOTHER_DIR, "instances.json");
export const TOKEN_POOL_FILE = resolve(MOTHER_DIR, "tokens.json");

// ============== Token Pool ==============

export function loadTokenPool(): TokenPoolConfig {
  try {
    const { readFileSync } = require("fs");
    const content = readFileSync(TOKEN_POOL_FILE, "utf-8");
    return JSON.parse(content) as TokenPoolConfig;
  } catch {
    return { tokens: [] };
  }
}

// ============== Validation ==============

if (!MOTHER_TOKEN) {
  console.error("ERROR: MOTHER_BOT_TOKEN is required in mother/.env");
  process.exit(1);
}

if (MOTHER_ALLOWED_USERS.length === 0) {
  console.error("ERROR: MOTHER_ALLOWED_USERS is required in mother/.env");
  process.exit(1);
}

console.log(
  `Mother config: ${MOTHER_ALLOWED_USERS.length} allowed users, repo: ${REPO_ROOT}`
);
