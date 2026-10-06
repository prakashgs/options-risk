import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PositionSnapshot } from "@options-risk/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

function ensureDir() {
  mkdirSync(root, { recursive: true });
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  writeFileSync(resolve(root, file), JSON.stringify(value, null, 2));
}

export interface StoredTokens {
  oauthToken: string;
  oauthTokenSecret: string;
}

export const store = {
  readTokens(): StoredTokens | null {
    return readJson<StoredTokens>("etrade-tokens.json");
  },
  writeTokens(tokens: StoredTokens) {
    writeJson("etrade-tokens.json", tokens);
  },
  clearTokens() {
    writeJson("etrade-tokens.json", {});
  },
  readSnapshot(): PositionSnapshot | null {
    return readJson<PositionSnapshot>("last-snapshot.json");
  },
  writeSnapshot(snapshot: PositionSnapshot) {
    writeJson("last-snapshot.json", snapshot);
  },
};
