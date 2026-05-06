import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_KEYBINDINGS } from "./keymap.js";

export type AppConfig = {
  keybindings: Record<string, string>;
  configPath: string;
  warnings: string[];
};

export function defaultGlobalConfigPath(): string {
  return path.join(os.homedir(), ".edit", "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfig(configPath: string = defaultGlobalConfigPath()): AppConfig {
  const config: AppConfig = {
    keybindings: { ...DEFAULT_KEYBINDINGS },
    configPath,
    warnings: []
  };

  if (!fs.existsSync(configPath)) {
    return config;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid config JSON at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid config at ${configPath}: expected a JSON object`);
  }

  const keybindings = parsed.keybindings;
  if (keybindings === undefined) {
    return config;
  }

  if (!isRecord(keybindings)) {
    throw new Error(`Invalid config at ${configPath}: keybindings must be an object`);
  }

  for (const [key, command] of Object.entries(keybindings)) {
    if (typeof command !== "string") {
      throw new Error(`Invalid config at ${configPath}: keybinding ${key} must map to a command string`);
    }
    config.keybindings[key] = command;
  }

  const seen = new Map<string, string>();
  for (const [key, command] of Object.entries(config.keybindings)) {
    const previous = seen.get(command);
    if (previous) {
      config.warnings.push(`Command ${command} is bound to both ${previous} and ${key}`);
    } else {
      seen.set(command, key);
    }
  }

  return config;
}
