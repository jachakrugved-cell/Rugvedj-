/**
 * JSON-file library of produced clips (no database needed).
 * Writes are atomic-ish (tmp file + rename) and serialized in-process.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CLIPS_DIR, LIBRARY_FILE, ensureDirs } from "./config";
import type { ClipRecord } from "./types";
export type { ClipRecord } from "./types";

let writeChain: Promise<void> = Promise.resolve();

export async function readLibrary(): Promise<ClipRecord[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(LIBRARY_FILE, "utf8");
    const parsed = JSON.parse(raw) as ClipRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLibrary(items: ClipRecord[]): Promise<void> {
  await ensureDirs();
  const tmp = `${LIBRARY_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await fs.rename(tmp, LIBRARY_FILE);
}

export function addClip(record: ClipRecord): Promise<ClipRecord[]> {
  writeChain = writeChain.then(async () => {
    const items = await readLibrary();
    const idx = items.findIndex((i) => i.id === record.id);
    if (idx >= 0) items[idx] = record;
    else items.unshift(record);
    await writeLibrary(items);
  });
  return writeChain.then(readLibrary);
}

export function removeClip(id: string): Promise<ClipRecord[]> {
  writeChain = writeChain.then(async () => {
    const items = await readLibrary();
    const target = items.find((i) => i.id === id);
    if (target) {
      try {
        await fs.unlink(target.file);
      } catch {
        /* already gone */
      }
    }
    await writeLibrary(items.filter((i) => i.id !== id));
  });
  return writeChain.then(readLibrary);
}

/** Resolve a library id to its record, guarding against path traversal. */
export async function findClip(id: string): Promise<ClipRecord | null> {
  const items = await readLibrary();
  const rec = items.find((i) => i.id === id);
  if (!rec) return null;
  const resolved = path.resolve(rec.file);
  if (!resolved.startsWith(path.resolve(CLIPS_DIR) + path.sep)) return null;
  return rec;
}
