type UserRow = { id: string; walletAddress: string | null; createdAt: Date };
type CreditRow = { userId: string; amount: number; type: string };
type TaskRow = { userId: string; status: string; createdAt: Date };
type RewardRow = { userId: string; status: string };

export function buildUserReport(input: {
  users: UserRow[];
  credits: CreditRow[];
  tasks: TaskRow[];
  rewards: RewardRow[];
  now?: Date;
}) {
  const balances = new Map(input.users.map((user) => [user.id, 0]));
  for (const entry of input.credits) {
    balances.set(entry.userId, (balances.get(entry.userId) ?? 0) + entry.amount);
  }
  const values = [...balances.values()];
  const now = input.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return {
    identityBoundary: {
      registeredAccounts: 0,
      durableSignIn: false,
      currentIdentity: "Signed anonymous browser session mapped to a PostgreSQL user UUID.",
      warning: "Clearing the session cookie can create a new identity; do not treat this as an anti-Sybil account count.",
    },
    users: {
      anonymousIdentities: input.users.length,
      walletLinked: input.users.filter((user) => user.walletAddress !== null).length,
      createdLast24Hours: input.users.filter((user) => user.createdAt >= dayAgo).length,
      createdLast7Days: input.users.filter((user) => user.createdAt >= weekAgo).length,
    },
    credits: {
      ledgerEntries: input.credits.length,
      issued: input.credits.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0),
      spent: Math.abs(input.credits.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0)),
      currentOutstanding: values.reduce((sum, balance) => sum + balance, 0),
      identitiesWithPositiveBalance: values.filter((balance) => balance > 0).length,
      identitiesWithNegativeBalance: values.filter((balance) => balance < 0).length,
    },
    tasks: {
      total: input.tasks.length,
      completed: input.tasks.filter((task) => task.status === "COMPLETED").length,
      processing: input.tasks.filter((task) => task.status === "PROCESSING").length,
      failed: input.tasks.filter((task) => task.status === "FAILED").length,
    },
    rewards: {
      confirmed: input.rewards.filter((reward) => reward.status === "CONFIRMED").length,
      reserved: input.rewards.filter((reward) => reward.status === "RESERVED").length,
    },
  };
}
