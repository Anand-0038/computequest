import { execFileSync } from "node:child_process";

import {
  isSupportedForgeVersion,
  parseForgeVersion,
  preflightMonadDeployment,
} from "../src/server/deployment/preflight";

async function main() {
  let forgeVersionOutput = "";
  try {
    forgeVersionOutput = execFileSync("forge", ["--version"], { encoding: "utf8", timeout: 10_000 });
  } catch {
    throw new Error("FOUNDRY_UNAVAILABLE");
  }
  const forgeVersion = parseForgeVersion(forgeVersionOutput);
  if (!isSupportedForgeVersion(forgeVersion)) throw new Error("FOUNDRY_1_8_OR_NEWER_REQUIRED");
  const report = await preflightMonadDeployment();
  process.stdout.write(`${JSON.stringify({ ...report, forgeVersion }, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

main().catch((error) => {
  const code = error instanceof Error && /^[A-Z0-9_:,]+$/.test(error.message) ? error.message : "DEPLOYMENT_PREFLIGHT_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
