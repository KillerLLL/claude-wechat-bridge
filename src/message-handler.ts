import type { Config } from "./config.js";
import type { WeixinApi } from "./weixin-api.js";
import type { ClaudeClient } from "./claude-client.js";
import type { SessionStore, MessageContent } from "./session-store.js";
import type { SessionMode } from "./session-store.js";
import type { WeixinMessage } from "./weixin-types.js";
import { MessageType, MessageItemType, TypingStatus } from "./weixin-types.js";
import { logger } from "./logger.js";
import { decryptImage } from "./image-decryptor.js";
import { WebSearchClient } from "./web-search.js";

// 默认搜索触发关键词（当环境变量未配置时使用）
const DEFAULT_SEARCH_KEYWORDS = [
  "新闻", "最新", "今天", "天气", "时事", "热点", "发生了什么",
  "最近", "当前", "现在", "实时", "行情", "股价", "汇率", "比分",
  "疫情", "通知", "公告", "上映", "播出", "比赛", "结果",
  "多少钱", "价格", "排名", "榜单",
];

// 消息去重：记录最近处理过的 message_id
const recentIds = new Set<number>();
const MAX_RECENT = 200;

export class MessageHandler {
  private webSearch: WebSearchClient | null;
  private searchKeywords: string[];

  constructor(
    private config: Config,
    private weixinApi: WeixinApi,
    private claudeClient: ClaudeClient,
    private sessions: SessionStore,
  ) {
    this.webSearch =
      config.WEB_SEARCH_API_KEY && config.WEB_SEARCH_ENDPOINT
        ? new WebSearchClient(config.WEB_SEARCH_ENDPOINT, config.WEB_SEARCH_API_KEY)
        : null;
    this.searchKeywords = config.WEB_SEARCH_KEYWORDS
      ? config.WEB_SEARCH_KEYWORDS.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_SEARCH_KEYWORDS;
  }

  async onMessage(msg: WeixinMessage): Promise<void> {
    // 只处理用户发送的消息（不处理 BOT 回复）
    if (msg.message_type !== MessageType.USER) return;

    // 去重
    if (msg.message_id != null) {
      const id = msg.message_id;
      if (recentIds.has(id)) return;
      recentIds.add(id);
      if (recentIds.size > MAX_RECENT) {
        const oldest = recentIds.values().next().value as number;
        recentIds.delete(oldest);
      }
    }

    // 提取文本内容（可选）
    const textItem = msg.item_list?.find(
      (item) => item.type === MessageItemType.TEXT && item.text_item?.text,
    );
    const text = textItem?.text_item?.text?.trim() || "";

    // 提取图片内容（可选）
    const imageMsgItem = msg.item_list?.find(
      (item) => item.type === MessageItemType.IMAGE && item.image_item,
    );

    // 至少要有文本或图片
    if (!text && !imageMsgItem) return;

    const sessionId = msg.session_id ?? "default";
    const fromUserId = msg.from_user_id ?? "";
    const contextToken = msg.context_token ?? "";

    // 模式切换指令检测
    const { CMD_PRO_MODE, CMD_NORMAL_MODE, REPLY_PRO_MODE, REPLY_NORMAL_MODE, CLAUDE_PRO_SYSTEM_PROMPT } = this.config;
    if (text === CMD_PRO_MODE || text === CMD_NORMAL_MODE) {
      const newMode: SessionMode = text === CMD_PRO_MODE ? "pro" : "normal";
      this.sessions.setMode(sessionId, newMode);
      this.sessions.clearHistory(sessionId);
      const reply = newMode === "pro" ? REPLY_PRO_MODE : REPLY_NORMAL_MODE;

      this.sessions.addUserMessage(sessionId, text);
      this.sessions.addAssistantMessage(sessionId, reply);
      this.sessions.setContextToken(sessionId, contextToken);
      try {
        await this.weixinApi.sendMessage(fromUserId, contextToken, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("发送模式切换回复失败", { error: errMsg });
      }
      return;
    }

    logger.info("收到消息", {
      from: fromUserId,
      text: text.substring(0, 100),
      hasImage: !!imageMsgItem,
      session: sessionId,
      contextToken: contextToken || "(empty)",
      messageId: msg.message_id,
      messageType: msg.message_type,
      messageState: msg.message_state,
    });

    // 更新会话上下文
    this.sessions.setContextToken(sessionId, contextToken);

    // 构建消息内容
    let userContent: MessageContent;
    let useVision = false;
    if (imageMsgItem) {
      useVision = true;
      const blocks: Extract<MessageContent, Array<unknown>> = [];

      const decrypted = await decryptImage(imageMsgItem.image_item!);
      if (decrypted) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: decrypted.mediaType,
            data: decrypted.base64Data,
          },
        });
      } else {
        blocks.push({ type: "text", text: "[图片处理失败，无法识别]" });
      }

      if (text) {
        blocks.push({ type: "text", text });
      } else {
        blocks.push({ type: "text", text: "请描述这张图片" });
      }

      userContent = blocks as MessageContent;
    } else {
      userContent = text;
    }

    // 添加用户消息到历史
    this.sessions.addUserMessage(sessionId, userContent);

    // 发送"正在输入"
    await this.sendTypingIndicator(sessionId, fromUserId, TypingStatus.TYPING);

    // 调用 Claude 生成回复
    let response: string;
    try {
      // 关键词触发搜索
      let searchContext = "";
      if (this.webSearch && text && this.searchKeywords.some((kw) => text.includes(kw))) {
        logger.info("触发联网搜索", { query: text });
        searchContext = await this.webSearch.search(text);
      }

      const history = this.sessions.getMessages(sessionId);
      const mode = this.sessions.getMode(sessionId);
      const systemOverride = mode === "pro" ? this.config.CLAUDE_PRO_SYSTEM_PROMPT : undefined;
      response = await this.claudeClient.generateResponse(history, useVision, searchContext, systemOverride);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("Claude API 调用失败", { error: errMsg });
      response = "抱歉，处理消息时遇到了错误，请稍后再试。";
    }

    // 裁剪历史
    this.sessions.trimToMaxHistory(sessionId, this.config.MAX_HISTORY);

    // 添加助手回复到历史
    this.sessions.addAssistantMessage(sessionId, response);

    // 取消"正在输入"
    await this.sendTypingIndicator(sessionId, fromUserId, TypingStatus.CANCEL);

    // 发送回复
    try {
      const currentToken = this.sessions.getContextToken(sessionId);
      await this.weixinApi.sendMessage(fromUserId, currentToken, response);
      logger.info("已发送回复", { to: fromUserId, length: response.length });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("发送消息失败", { error: errMsg });
    }
  }

  private async sendTypingIndicator(
    sessionId: string,
    userId: string,
    status: number,
  ): Promise<void> {
    try {
      let ticket = this.sessions.getTypingTicket(sessionId);
      if (!ticket) {
        const config = await this.weixinApi.getConfig(userId);
        ticket = config.typing_ticket;
        if (ticket) this.sessions.setTypingTicket(sessionId, ticket);
      }
      if (ticket) {
        await this.weixinApi.sendTyping(userId, ticket, status);
      }
    } catch {
      // typing indicator 非关键，静默忽略
    }
  }
}