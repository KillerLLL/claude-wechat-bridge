import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import type { ClaudeMessage } from "./session-store.js";
import { logger } from "./logger.js";

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;

  constructor(config: Config) {
    const opts: { apiKey: string; baseURL?: string } = { apiKey: config.ANTHROPIC_API_KEY };
    if (config.ANTHROPIC_BASE_URL) opts.baseURL = config.ANTHROPIC_BASE_URL;
    this.client = new Anthropic(opts);
    this.model = config.CLAUDE_MODEL;
    this.systemPrompt = config.CLAUDE_SYSTEM_PROMPT;
    this.maxTokens = config.CLAUDE_MAX_TOKENS;
  }

  async generateResponse(messages: ClaudeMessage[]): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    logger.debug("Claude response generated", {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return text;
  }
}