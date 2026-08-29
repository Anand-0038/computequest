import { closeDatabase, getDatabase } from "@/server/db/client";
import { campaignRewardClaims, creditEntries, tasks, users } from "@/server/db/schema";
import { requireDatabaseEnv } from "@/server/env";
import { buildUserReport } from "@/domain/user-report";

async function main() {
  requireDatabaseEnv();
  try {
    const db = getDatabase();
    const [userRows, creditRows, taskRows, rewardRows] = await Promise.all([
      db.select().from(users),
      db.select().from(creditEntries),
      db.select().from(tasks),
      db.select().from(campaignRewardClaims),
    ]);
    console.log(JSON.stringify(buildUserReport({ users: userRows, credits: creditRows, tasks: taskRows, rewards: rewardRows }), null, 2));
  } finally {
    await closeDatabase();
  }
}

void main();
