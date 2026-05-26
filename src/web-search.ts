import { logger } from "./logger.js";

interface SearchHit {
  title: string;
  link: string;
  content: string;
  refer: string;
}

export class WebSearchClient {
  private endpoint: string;
  private apiKey: string;
  private sessionId: string | null = null;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
    };
    if (params !== undefined) body.params = params;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // 从响应头获取 session ID
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    const text = await res.text();

    // 从 SSE 流中提取 data 行
    let dataPayload: string | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        dataPayload = line.slice(5).trim();
      }
    }

    if (!dataPayload) {
      throw new Error(`MCP 无响应数据: ${text.substring(0, 200)}`);
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(dataPayload);
    } catch {
      throw new Error(`MCP 响应解析失败: ${dataPayload.substring(0, 200)}`);
    }

    if (json.error) {
      throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
    }

    return json.result ?? null;
  }

  private async doSearch(query: string): Promise<{ ok: boolean; text: string }> {
    const result = (await this.rpc("tools/call", {
      name: "web_search_prime",
      arguments: { search_query: query, content_size: "medium", location: "cn" },
    })) as { content?: Array<{ type: string; text?: string }> | null } | null;

    if (!result?.content?.[0]?.text) {
      return { ok: false, text: "" };
    }

    const rawText = result.content[0].text;
    if (rawText.includes("MCP error") || rawText.includes("contentFilter")) {
      return { ok: false, text: "CONTENT_FILTER" };
    }

    return { ok: true, text: rawText };
  }

  async search(query: string): Promise<string> {
    try {
      // 初始化会话
      this.sessionId = null;
      await this.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "claude-wechat-bridge", version: "1.0.0" },
      });

      // 第一次搜索
      let searchResult = await this.doSearch(query);

      // 被内容审查拦截时，用 location=us 重试
      if (searchResult.text === "CONTENT_FILTER") {
        logger.info("CN 搜索被拦截，尝试 US 节点", { query });
        this.sessionId = null;
        await this.rpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "claude-wechat-bridge", version: "1.0.0" },
        });

        const retryResult = (await this.rpc("tools/call", {
          name: "web_search_prime",
          arguments: { search_query: query, content_size: "medium", location: "us" },
        })) as { content?: Array<{ type: string; text?: string }> | null } | null;

        if (retryResult?.content?.[0]?.text) {
          const retryText = retryResult.content[0].text;
          if (!retryText.includes("MCP error") && !retryText.includes("contentFilter")) {
            searchResult = { ok: true, text: retryText };
          }
        }
      }

      if (!searchResult.ok || !searchResult.text || searchResult.text === "CONTENT_FILTER") {
        return "搜索未返回结果，可能是内容安全策略限制。";
      }

      // 解析搜索结果
      let rawText = searchResult.text;
      if (rawText.startsWith('"')) {
        try { rawText = JSON.parse(rawText); } catch { /* ignore */ }
      }
      if (rawText === "[]" || !rawText) {
        return "搜索未返回结果。";
      }

      let hits: SearchHit[];
      try {
        hits = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
      } catch {
        logger.warn("搜索结果解析失败", { raw: rawText.substring(0, 200) });
        return "搜索结果解析失败。";
      }

      if (!Array.isArray(hits) || hits.length === 0) {
        return "搜索未返回结果。";
      }

      const formatted = hits
        .slice(0, 6)
        .map((h, i) => `[${i + 1}] ${h.title}\n${h.link}\n${h.content}`)
        .join("\n\n");

      logger.info("搜索完成", { query, hits: hits.length });
      return formatted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("搜索失败", { query, error: msg });
      return `搜索失败: ${msg}`;
    }
  }
}
