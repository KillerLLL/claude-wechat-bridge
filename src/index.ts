import "dotenv/config";
import { loadConfig } from "./config.js";
import { setLogLevel, logger } from "./logger.js";
import { ClaudeClient } from "./claude-client.js";
import { WeixinApi } from "./weixin-api.js";
import { SessionStore } from "./session-store.js";
import { MessageHandler } from "./message-handler.js";
import { Poller } from "./poller.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.LOG_LEVEL);

  logger.info("Claude-WeChat Bridge 启动中...");
  logger.info(`Claude 模型: ${config.CLAUDE_MODEL}`);
  logger.info(`微信 API: ${config.WECHAT_BASE_URL}`);

  const claudeClient = new ClaudeClient(config);
  const weixinApi = new WeixinApi(config);
  const sessions = new SessionStore();
  const handler = new MessageHandler(config, weixinApi, claudeClient, sessions);
  const poller = new Poller(config, weixinApi, handler);

  // 优雅退出
  const shutdown = (signal: string) => {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
    poller.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("未处理的 Promise 拒绝", { reason: String(reason) });
  });

  await poller.start();
  logger.info("服务已停止");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
