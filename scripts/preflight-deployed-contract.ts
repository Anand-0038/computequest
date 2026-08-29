import { preflightMonadRuntime } from "../src/server/chain/monad";

preflightMonadRuntime()
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 1;
  })
  .catch(() => {
    process.stderr.write("DEPLOYED_CONTRACT_PREFLIGHT_FAILED\n");
    process.exitCode = 1;
  });
