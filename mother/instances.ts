/**
 * Instance state management for Mother Bot.
 */

import { readFileSync } from "fs";
import { INSTANCES_FILE } from "./config";
import type {
  Instance,
  InstanceStore,
  TokenEntry,
  TokenPoolConfig,
} from "./types";

export function loadInstances(): InstanceStore {
  try {
    const content = readFileSync(INSTANCES_FILE, "utf-8");
    return JSON.parse(content) as InstanceStore;
  } catch {
    return { instances: [] };
  }
}

export function saveInstances(store: InstanceStore): void {
  Bun.write(INSTANCES_FILE, JSON.stringify(store, null, 2));
}

export function addInstance(instance: Instance): void {
  const store = loadInstances();
  store.instances.push(instance);
  saveInstances(store);
}

export function removeInstance(name: string): Instance | null {
  const store = loadInstances();
  const idx = store.instances.findIndex((i) => i.name === name);
  if (idx === -1) return null;
  const [removed] = store.instances.splice(idx, 1);
  saveInstances(store);
  return removed!;
}

export function updateInstance(
  name: string,
  updates: Partial<Instance>
): void {
  const store = loadInstances();
  const instance = store.instances.find((i) => i.name === name);
  if (instance) {
    Object.assign(instance, updates);
    saveInstances(store);
  }
}

export function getInstance(name: string): Instance | null {
  const store = loadInstances();
  return store.instances.find((i) => i.name === name) || null;
}

export function getAllInstances(): Instance[] {
  return loadInstances().instances;
}

/**
 * Find an available token from the pool (not assigned to any active instance).
 */
export function getAvailableToken(
  pool: TokenPoolConfig
): TokenEntry | null {
  const store = loadInstances();
  const usedTokens = new Set(store.instances.map((i) => i.botToken));
  return pool.tokens.find((t) => !usedTokens.has(t.token)) || null;
}
