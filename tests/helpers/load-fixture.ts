import { readFileSync } from "node:fs";
import path from "node:path";

export function loadFixture(name: string): unknown {
  const file = path.resolve(import.meta.dirname, "..", "fixtures", name);
  return JSON.parse(readFileSync(file, "utf8"));
}
