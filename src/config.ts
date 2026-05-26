import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  WECHAT_TOKEN: z.string().min(1, "WECHAT_TOKEN is required (see README for QR login)"),
  WECHAT_USER_ID: z.string().min(1, "WECHAT_USER_ID is required"),
  WECHAT_BASE_URL: z.string().url().default("https://ilinkai.weixin.qq.com"),
  CLAUDE_MODEL: z.string().default("glm-5.1"),
  CLAUDE_SYSTEM_PROMPT: z.string().default("你是一个通过微信回复消息的AI助手。回复应简洁、格式清晰。"),
  MAX_HISTORY: z.coerce.number().int().positive().default(20),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  IMAGE_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  IMAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}