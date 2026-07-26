/** Models offered in the Agents console picker. First entry is the live default (see sms-agent.ts). */
export const AGENT_MODELS = [
  "glm-5.2",
  "kimi-k2.6",
  "deepseek-v4-pro",
  "minimax-m2.7",
  "qwen3.5:397b",
  "gpt-oss:120b",
  "gemini-2.5-flash",
] as const;

export type ChatTurn = { from: "them" | "us"; text: string };
