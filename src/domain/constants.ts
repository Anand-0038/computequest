export const TASK_COST = 24;
export const INITIAL_DEMO_BALANCE = 4;
export const QUEST_REWARD = 20;
export const TASK_TYPE = "PITCH_DECK" as const;
export const MONAD_TESTNET_CHAIN_ID = 10143;

if (INITIAL_DEMO_BALANCE + QUEST_REWARD !== TASK_COST) {
  throw new Error("The canonical ComputeQuest demo economics are inconsistent");
}
