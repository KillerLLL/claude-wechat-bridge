import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  WECHAT_TOKEN: z.string().min(1, "WECHAT_TOKEN is required (see README for QR login)"),
  WECHAT_USER_ID: z.string().min(1, "WECHAT_USER_ID is required"),
  WECHAT_BASE_URL: z.string().url().default("https://ilinkai.weixin.qq.com"),
  CLAUDE_MODEL: z.string().min(1, "CLAUDE_MODEL is required"),
  CLAUDE_VISION_MODEL: z.string().default(""),
  CLAUDE_SYSTEM_PROMPT: z.string().default("你是一个通过微信回复消息的AI助手。回复应简洁、格式清晰。"),
  CLAUDE_PRO_SYSTEM_PROMPT: z.string().default("你是一个专业的AI助手。回复应准确、简洁、格式清晰。"),
  CMD_PRO_MODE: z.string().default("臭居认真"),
  CMD_NORMAL_MODE: z.string().default("臭居放松"),
  REPLY_PRO_MODE: z.string().default("好的主人，已切换到认真模式🐱 我会认真回答你的每一个问题。"),
  REPLY_NORMAL_MODE: z.string().default("好耶！回到放松模式啦～嘻嘻嘻 😸"),
  MAX_HISTORY: z.coerce.number().int().positive().default(20),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  IMAGE_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  IMAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  WEB_SEARCH_ENDPOINT: z.string().default(""),
  WEB_SEARCH_API_KEY: z.string().default(""),
  WEB_SEARCH_KEYWORDS: z.string().default(""),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}