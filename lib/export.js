import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.js";

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

function norm(p) {
  const resolved = path.resolve(p);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

export function isInside(child, parent) {
  const rel = path.relative(norm(parent), norm(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** realpath of the deepest existing ancestor + the not-yet-existing tail. */
function realpathLoose(target) {
  let current = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function rootsFromEnv(env = process.env) {
  return String(env.ROUNDTABLE_EXPORT_ROOTS || "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

export function rootsFromMcp(roots) {
  const out = [];
  for (const root of roots || []) {
    if (typeof root?.uri !== "string" || !root.uri.startsWith("file:")) continue;
    try {
      out.push(fileURLToPath(root.uri));
    } catch {
      // Ignore malformed URIs from the client.
    }
  }
  return out;
}

/**
 * Decide where an export may be written.
 *
 * - no output_path               -> <exportsDir>/<debate_id>-<format>.md
 * - bare file name ("001.md")    -> <exportsDir>/001.md
 * - relative path with folders   -> resolved against the first MCP root the
 *                                   client shared (the project it is working on)
 * - absolute path                -> as given
 *
 * The final path must end in .md and sit inside an allowed root: the exports
 * dir, ROUNDTABLE_EXPORT_ROOTS, or the client's MCP roots. Files may only be
 * overwritten inside the exports dir; anywhere else existing files are never
 * replaced (protects code/config from prompt-injected exports).
 */
export function resolveExportTarget({ outputPath, debateId, format, exportsDir, envRoots = [], clientRoots = [] }) {
  let candidate;
  if (outputPath === undefined || outputPath === null || String(outputPath).trim() === "") {
    candidate = path.join(exportsDir, `${debateId}-${format}.md`);
  } else {
    const raw = String(outputPath).trim();
    if (!raw.toLowerCase().endsWith(".md")) {
      fail("EXPORT_PATH_REJECTED", `output_path must end in '.md' (got '${raw}').`);
    }
    if (path.isAbsolute(raw)) {
      candidate = path.resolve(raw);
    } else if (!/[\\/]/.test(raw)) {
      candidate = path.join(exportsDir, raw);
    } else if (clientRoots.length > 0) {
      candidate = path.resolve(clientRoots[0], raw);
    } else {
      fail(
        "EXPORT_PATH_REJECTED",
        `Relative path '${raw}' is ambiguous: this client did not share its project folder (MCP roots). ` +
          `Pass an absolute path inside an allowed folder, or just a file name to save it in ${exportsDir}.`
      );
    }
  }

  const allowed = [exportsDir, ...envRoots, ...clientRoots].map((r) => realpathLoose(r));
  const real = realpathLoose(candidate);
  if (!allowed.some((root) => isInside(real, root))) {
    fail(
      "EXPORT_PATH_REJECTED",
      `Refusing to write '${candidate}': it is outside the allowed export folders (${allowed.join(", ")}). ` +
        `Add the folder to ROUNDTABLE_EXPORT_ROOTS or open it as a project in your client.`
    );
  }
  return { file: real, overwriteAllowed: isInside(real, realpathLoose(exportsDir)) };
}

export function writeExport({ file, overwriteAllowed }, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      fail("EXPORT_PATH_REJECTED", `Refusing to write through symbolic link '${file}'.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    fs.writeFileSync(file, content, { encoding: "utf-8", flag: overwriteAllowed ? "w" : "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      fail(
        "EXPORT_EXISTS",
        `'${file}' already exists and is outside the exports folder, so it will not be overwritten. Choose a new file name.`
      );
    }
    throw error;
  }
  return file;
}
