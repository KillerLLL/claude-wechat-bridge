import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
import type { Config } from "./config.js";
import type {
  BaseInfo,
  GetUpdatesResp,
  GetConfigResp,
  SendMessageReq,
  SendTypingReq,
} from "./weixin-types.js";
import { MessageType, MessageState, MessageItemType } from "./weixin-types.js";

// --- 读取 package.json 中的 ilink_appid 和 version ---
interface PkgJson {
  ilink_appid?: string;
  version?: string;
}

function readPkg(): PkgJson {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const p = path.resolve(dir, "..", "package.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

const pkg = readPkg();
const ILINK_APP_ID = pkg.ilink_appid ?? "bot";
const CHANNEL_VERSION = pkg.version ?? "1.0.0";

// version -> uint32: 0x00MMNNPP
function buildClientVersion(v: string): number {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map(Number);
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

const CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION);

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

// --- 超时常量 ---
const POLL_TIMEOUT = 35_000;
const API_TIMEOUT = 15_000;
const CONFIG_TIMEOUT = 10_000;

// --- Session 过期错误 ---
export class SessionExpiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SessionExpiredError";
  }
}

// --- X-WECHAT-UIN: random uint32 -> decimal string -> base64 ---
function randomWechatUin(): string {
  const n = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(n), "utf-8").toString("base64");
}

function buildHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(CLIENT_VERSION),
  };
  if (token?.trim()) {
    h.Authorization = `Bearer ${token.trim()}`;
  }
  return h;
}

async function postJson<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  token: string,
  timeoutMs: number,
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}`;
  const bodyStr = JSON.stringify(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(token),
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    logger.debug(`POST ${endpoint} status=${res.status} body=${text.substring(0, 500)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return JSON.parse(text) as T;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// --- 公开 API ---

export interface WeixinApiOptions {
  baseUrl: string;
  token: string;
}

export class WeixinApi {
  constructor(private config: Config) {}

  async getUpdates(cursor: string): Promise<GetUpdatesResp> {
    try {
      const resp = await postJson<GetUpdatesResp>(
        this.config.WECHAT_BASE_URL,
        "ilink/bot/getupdates",
        { get_updates_buf: cursor, base_info: buildBaseInfo() },
        this.config.WECHAT_TOKEN,
        POLL_TIMEOUT,
      );
      return resp;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // 长轮询超时是正常的，返回空响应让调用方重试
        return { ret: 0, msgs: [], get_updates_buf: cursor };
      }
      throw err;
    }
  }

  async sendMessage(toUserId: string, contextToken: string, text: string): Promise<void> {
    const chunks = splitText(text, 4000);
    for (const chunk of chunks) {
      const clientId = `openclaw-weixin-${crypto.randomUUID().substring(0, 8)}`;
      const body: SendMessageReq = {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId,
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          context_token: contextToken || undefined,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
        },
      };
      const reqBody = { ...body, base_info: buildBaseInfo() };
      logger.info("sendMessage 请求体", { body: JSON.stringify(reqBody).substring(0, 500) });
      const resp = await postJson<Record<string, unknown>>(
        this.config.WECHAT_BASE_URL,
        "ilink/bot/sendmessage",
        reqBody,
        this.config.WECHAT_TOKEN,
        API_TIMEOUT,
      );
      logger.info("sendMessage 响应", {
        to: toUserId,
        clientId,
        contextToken: contextToken?.substring(0, 20) || "(empty)",
        resp: JSON.stringify(resp),
      });
    }
  }

  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    return postJson<GetConfigResp>(
      this.config.WECHAT_BASE_URL,
      "ilink/bot/getconfig",
      { ilink_user_id: ilinkUserId, context_token: contextToken, base_info: buildBaseInfo() },
      this.config.WECHAT_TOKEN,
      CONFIG_TIMEOUT,
    );
  }

  async sendTyping(ilinkUserId: string, typingTicket: string, status: number): Promise<void> {
    const body: SendTypingReq = {
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status,
    };
    await postJson(
      this.config.WECHAT_BASE_URL,
      "ilink/bot/sendtyping",
      { ...body, base_info: buildBaseInfo() },
      this.config.WECHAT_TOKEN,
      CONFIG_TIMEOUT,
    );
  }
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.substring(i, i + maxLen));
  }
  return chunks;
}
