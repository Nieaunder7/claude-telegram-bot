/**
 * Type definitions for Mother Bot.
 */

/** A single bot instance managed by the mother bot */
export interface Instance {
  name: string;
  worktreePath: string;
  zellijSession: string;
  botToken: string;
  botUsername: string;
  workingDir: string;
  allowedUsers: string;
  status: "running" | "stopped";
  createdAt: string;
}

/** Persistent state file */
export interface InstanceStore {
  instances: Instance[];
}

/** A bot token in the pool */
export interface TokenEntry {
  token: string;
  label: string;
}

/** Token pool configuration file */
export interface TokenPoolConfig {
  tokens: TokenEntry[];
}
