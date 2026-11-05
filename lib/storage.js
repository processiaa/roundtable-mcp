import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RoundtableError, fail } from "./errors.js";

// Errors that Windows (and some network/sync folders) raise transiently while
// another process holds or renames the file. Worth a short retry.
const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES", "EAGAIN", "EMFILE"]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const DEBATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve storage locations.
 *
 * ROUNDTABLE_STORAGE_PATH keeps working as before:
 *   - pointing to a *.json file (v0.4 style) -> that file is the legacy store to
 *     migrate, and the new layout lives in the same folder;
 *   - pointing to a folder -> that folder is the base directory.
 */
export function resolveStoragePaths(env = process.env) {
  const raw = env.ROUNDTABLE_STORAGE_PATH;
  let baseDir;
  let legacyFile;
  if (raw && raw.trim()) {
    const resolved = path.resolve(raw.trim());
    if (resolved.toLowerCase().endsWith(".json")) {
      baseDir = path.dirname(resolved);
      legacyFile = resolved;
    } else {
      baseDir = resolved;
      legacyFile = path.join(baseDir, "debates.json");
    }
  } else {
    baseDir = path.join(os.homedir(), ".roundtable_mcp");
    legacyFile = path.join(baseDir, "debates.json");
  }
  return {
    baseDir,
    legacyFile,
    debatesDir: path.join(baseDir, "debates"),
    locksDir: path.join(baseDir, "locks"),
    exportsDir: path.join(baseDir, "exports"),
  };
}

export function validateDebateId(id) {
  if (typeof id !== "string" || !DEBATE_ID_RE.test(id)) {
    fail(
      "INVALID_DEBATE_ID",
      `Invalid debate_id '${id}'. Use 1-100 characters: letters, digits, '.', '_' or '-', starting with a letter or digit.`
    );
  }
  if (WINDOWS_RESERVED.test(id.split(".")[0])) {
    fail("INVALID_DEBATE_ID", `debate_id '${id}' is a reserved device name on Windows.`);
  }
  return id;
}

async function withRetry(fn, { attempts = 10, baseDelayMs = 15 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (error) {
      if (!TRANSIENT_CODES.has(error.code)) throw error;
      lastError = error;
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastError;
}

export class Storage {
  constructor(paths = resolveStoragePaths(), options = {}) {
    this.paths = paths;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.staleLockMs = options.staleLockMs ?? 10000;
  }

  ensureDirs() {
    for (const dir of [this.paths.debatesDir, this.paths.locksDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  debateFile(id) {
    return path.join(this.paths.debatesDir, `${validateDebateId(id)}.json`);
  }

  // ---------------------------------------------------------------- locking

  async acquireLock(name) {
    this.ensureDirs();
    const lockFile = path.join(this.paths.locksDir, `${name}.lock`);
    const deadline = Date.now() + this.lockTimeoutMs;
    let delay = 10;
    for (;;) {
      try {
        const fd = fs.openSync(lockFile, "wx");
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        fs.closeSync(fd);
        return lockFile;
      } catch (error) {
        if (error.code !== "EEXIST" && !TRANSIENT_CODES.has(error.code)) throw error;
      }
      // Break locks left behind by a process that died mid-write.
      try {
        const age = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (age > this.staleLockMs) {
          fs.rmSync(lockFile, { force: true });
          continue;
        }
      } catch {
        // Lock vanished between open and stat: just retry.
      }
      if (Date.now() > deadline) {
        fail(
          "LOCK_TIMEOUT",
          `Could not lock '${name}' within ${this.lockTimeoutMs} ms (another roundtable-mcp process is writing). Retry the call.`
        );
      }
      await sleep(delay + Math.floor(Math.random() * 10));
      delay = Math.min(delay * 2, 100);
    }
  }

  releaseLock(lockFile) {
    try {
      fs.rmSync(lockFile, { force: true });
    } catch {
      // A stale-lock sweep from another process may have removed it already.
    }
  }

  async withLock(name, fn) {
    const lockFile = await this.acquireLock(name);
    try {
      return await fn();
    } finally {
      this.releaseLock(lockFile);
    }
  }

  // ------------------------------------------------------------- raw io

  async readFileOrNull(file) {
    try {
      return await withRetry(() => fs.readFileSync(file, "utf-8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      fail("STORAGE_READ_FAILED", `Could not read ${file}: ${error.message}`);
    }
  }

  async writeJsonAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    try {
      await withRetry(() => fs.renameSync(tmp, file));
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      fail("STORAGE_WRITE_FAILED", `Could not write ${file}: ${error.message}`);
    }
  }

  // ------------------------------------------------------------ debates

  /** Returns the debate, or null if it does not exist. Never hides corruption. */
  async read(id) {
    const file = this.debateFile(id);
    const raw = await this.readFileOrNull(file);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      fail(
        "STORAGE_CORRUPT",
        `Debate file ${file} is not valid JSON (${error.message}). It was left untouched; fix or delete it manually.`
      );
    }
  }

  exists(id) {
    return fs.existsSync(this.debateFile(id));
  }

  /**
   * Read-modify-write a debate under its lock.
   * `mutator(current)` returns `{ save?: debate, remove?: true, result }`.
   */
  async update(id, mutator) {
    validateDebateId(id);
    return this.withLock(`debate-${id}`, async () => {
      const current = await this.read(id);
      const outcome = (await mutator(current)) || {};
      if (outcome.remove) {
        await withRetry(() => fs.rmSync(this.debateFile(id), { force: true }));
      } else if (outcome.save) {
        await this.writeJsonAtomic(this.debateFile(id), outcome.save);
      }
      return outcome.result;
    });
  }

  /** Lists every debate. Unreadable files are reported, never silently dropped. */
  async list() {
    let names = [];
    try {
      names = fs.readdirSync(this.paths.debatesDir);
    } catch (error) {
      if (error.code === "ENOENT") return { debates: [], errors: [] };
      throw error;
    }
    const debates = [];
    const errors = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      try {
        const debate = await this.read(id);
        if (debate) debates.push(debate);
      } catch (error) {
        errors.push({ file: name, error: error.message });
      }
    }
    return { debates, errors };
  }

  // ---------------------------------------------------------- migration

  /**
   * Moves debates from the single v0.4 debates.json into one file per debate.
   * The old file is renamed to *.bak (never deleted). Safe to call on every
   * start and from several processes at once.
   */
  async migrateLegacy() {
    const legacy = this.paths.legacyFile;
    if (!fs.existsSync(legacy)) return { migrated: [], skipped: [], backup: null };

    return this.withLock("migration", async () => {
      if (!fs.existsSync(legacy)) return { migrated: [], skipped: [], backup: null };
      const raw = await this.readFileOrNull(legacy);
      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        throw new RoundtableError(
          "LEGACY_CORRUPT",
          `Legacy store ${legacy} is not valid JSON (${error.message}); it was not migrated or modified.`
        );
      }
      const migrated = [];
      const skipped = [];
      for (const [id, debate] of Object.entries(data || {})) {
        try {
          validateDebateId(id);
        } catch (error) {
          skipped.push({ id, reason: error.message });
          continue;
        }
        if (this.exists(id)) {
          skipped.push({ id, reason: "a debate with this id already exists in the new store" });
          continue;
        }
        await this.writeJsonAtomic(this.debateFile(id), { ...debate, debate_id: id });
        migrated.push(id);
      }
      // Verify before retiring the old file.
      for (const id of migrated) {
        const check = await this.read(id);
        if (!check) fail("MIGRATION_FAILED", `Migrated debate '${id}' could not be read back.`);
      }
      let backup = `${legacy}.bak`;
      if (fs.existsSync(backup)) backup = `${legacy}.${Date.now()}.bak`;
      await withRetry(() => fs.renameSync(legacy, backup));
      return { migrated, skipped, backup };
    });
  }
}
