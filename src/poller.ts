import type { Config } from "./config.js";
import type { MessageHandler } from "./message-handler.js";
import type { WeixinApi } from "./weixin-api.js";
import { SessionExpiredError } from "./weixin-api.js";
import { logger } from "./logger.js";

const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

export class Poller {
  private cursor = "";
  private running = false;
  private retryDelay = MIN_RETRY_MS;

  constructor(
    private config: Config,
    private api: WeixinApi,
    private handler: MessageHandler,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    logger.info("开始长轮询...", { baseUrl: this.config.WECHAT_BASE_URL });

    while (this.running) {
      try {
        const resp = await this.api.getUpdates(this.cursor);

        // ret 只在错误时出现，正常响应没有 ret 字段
        if (resp.ret != null && resp.ret !== 0) {
          if (resp.errcode === -14) {
            throw new SessionExpiredError(
              `Session 过期 (errcode: -14)，请重新扫码登录并更新 .env 中的 WECHAT_TOKEN`,
            );
          }
          throw new Error(
            `getUpdates 返回错误: ret=${resp.ret} errcode=${resp.errcode} msg=${resp.errmsg}`,
          );
        }

        // 更新游标
        if (resp.get_updates_buf) {
          this.cursor = resp.get_updates_buf;
        }

        // 重置重试延迟
        this.retryDelay = MIN_RETRY_MS;

        // 处理消息
        if (resp.msgs && resp.msgs.length > 0) {
          logger.info("收到新消息", { count: resp.msgs.length });
          for (const msg of resp.msgs) {
            await this.handler.onMessage(msg);
          }
        }
      } catch (err) {
        if (!this.running) break;

        if (err instanceof SessionExpiredError) {
          logger.error(err.message);
          logger.error("========================================");
          logger.error("请执行以下步骤重新登录：");
          logger.error("  1. 运行: openclaw channels login --channel openclaw-weixin");
          logger.error("  2. 扫码登录后，读取 ~/.openclaw/openclaw-weixin/accounts/ 下的 token");
          logger.error("  3. 更新 .env 中的 WECHAT_TOKEN 和 WECHAT_USER_ID");
          logger.error("  4. 重新启动本服务");
          logger.error("========================================");
          break; // session 过期需要手动干预，停止轮询
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`轮询出错，${this.retryDelay}ms 后重试`, { error: errMsg });
        await this.sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
      }
    }

    logger.info("轮询已停止");
  }

  stop(): void {
    this.running = false;
    logger.info("正在停止轮询...");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref(); // 不阻止进程退出
    });
  }
}
