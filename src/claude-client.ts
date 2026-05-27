import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import type { ClaudeMessage } from "./session-store.js";
import { logger } from "./logger.js";

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private visionModel: string;
  private systemPrompt: string;
  private maxTokens: number;

  constructor(config: Config) {
    const opts: { apiKey: string; baseURL?: string } = { apiKey: config.ANTHROPIC_API_KEY };
    if (config.ANTHROPIC_BASE_URL) opts.baseURL = config.ANTHROPIC_BASE_URL;
    this.client = new Anthropic(opts);
    this.model = config.CLAUDE_MODEL;
    this.visionModel = config.CLAUDE_VISION_MODEL || config.CLAUDE_MODEL;
    this.systemPrompt = config.CLAUDE_SYSTEM_PROMPT;
    this.maxTokens = config.CLAUDE_MAX_TOKENS;
  }

  async generateResponse(
    messages: ClaudeMessage[],
    useVision = false,
    searchContext = "",
    systemPromptOverride?: string,
  ): Promise<string> {
    const model = useVision ? this.visionModel : this.model;
    const basePrompt = systemPromptOverride ?? this.systemPrompt;
    const system = searchContext
      ? `${basePrompt}\n\n以下是从互联网搜索到的参考信息，请基于这些信息回答用户的问题：\n\n${searchContext}`
      : basePrompt;

    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

    const response = await this.client.messages.create({
      model,
      max_tokens: this.maxTokens,
      system,
      messages: apiMessages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    if (!text.trim()) {
      logger.warn("模型返回空文本");
      return "抱歉，我暂时无法回答这个问题。";
    }

    logger.info("Claude response generated", {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      hasSearch: !!searchContext,
    });

    return text;
  }
}
