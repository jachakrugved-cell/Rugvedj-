/**
 * In-process task registry with pub/sub for Server-Sent Events.
 * Every clip job, download and live recording is a Task the UI can follow.
 */
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { Task } from "./types";
export type { Task, TaskState } from "./types";

const MAX_TASKS = 200;
const tasks = new Map<string, Task>();
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function newId(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

export function createTask(
  init: Pick<Task, "kind" | "title"> & Partial<Task>,
): Task {
  const now = Date.now();
  const task: Task = {
    id: init.id ?? newId("t_"),
    state: "queued",
    progress: 0,
    message: "Queued",
    createdAt: now,
    updatedAt: now,
    ...init,
  } as Task;
  tasks.set(task.id, task);
  trim();
  emit(task);
  return task;
}

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const task = tasks.get(id);
  if (!task) return null;
  Object.assign(task, patch, { updatedAt: Date.now() });
  emit(task);
  return task;
}

export function getTask(id: string): Task | null {
  return tasks.get(id) ?? null;
}

export function listTasks(limit = 50): Task[] {
  return [...tasks.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function emit(task: Task) {
  bus.emit("task", task);
}

function trim() {
  if (tasks.size <= MAX_TASKS) return;
  const oldest = [...tasks.values()]
    .filter((t) => t.state === "done" || t.state === "error" || t.state === "cancelled")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  while (tasks.size > MAX_TASKS && oldest.length) {
    const t = oldest.shift()!;
    tasks.delete(t.id);
  }
}
