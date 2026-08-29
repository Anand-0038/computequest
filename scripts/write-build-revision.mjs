import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function resolveRevision() {
  const renderRevision = process.env.RENDER_GIT_COMMIT?.trim();
  if (renderRevision) return renderRevision;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

await writeFile(resolve(process.cwd(), ".build-revision"), `${resolveRevision()}\n`, "utf8");
