# Claude-WeChat Bridge

将微信消息桥接到 Claude AI 的独立服务。基于微信 openclaw-weixin 协议，不依赖 OpenClaw 框架。

## 架构

```
微信用户 → 微信服务器 → getUpdates 长轮询 → 本服务 → Claude API → sendMessage → 微信用户
```

## 前置条件

- Node.js >= 22
- 微信 >= 8.0.70（已开通 ClawBot 插件）
- Anthropic API Key

## 快速开始

### 1. 获取微信 Token（首次必须）

这一步需要先通过 OpenClaw 扫码获取 token，之后本服务即可独立运行。

```bash
# 安装 OpenClaw（临时使用，仅用于获取 token）
npm install -g openclaw

# 安装微信插件
npx -y @tencent-weixin/openclaw-weixin-cli install

# 启用插件
openclaw config set plugins.entries.openclaw-weixin.enabled true

# 扫码登录
openclaw channels login --channel openclaw-weixin
```

终端会显示二维码，打开微信 → 我 → 设置 → 插件 → 找到 "ClawBot" → 扫码确认。

登录成功后，token 保存在：

```bash
# 查看账户目录
ls ~/.openclaw/openclaw-weixin/accounts/

# 查看某个账户的 token 和 userId
cat ~/.openclaw/openclaw-weixin/accounts/<accountId>.json
```

你需要记下 `token` 和 `userId` 两个字段的值。

### 2. 配置本服务

```bash
cd F:\work\claude-wechat-bridge

# 安装依赖
npm install

# 创建配置文件
cp .env.example .env
```

编辑 `.env`，填入以下必填项：

```env
ANTHROPIC_API_KEY=sk-ant-你的key
WECHAT_TOKEN=扫码获得的token
WECHAT_USER_ID=扫码获得的userId
```

### 3. 启动

```bash
npm start
```

看到以下日志说明启动成功：

```
Claude-WeChat Bridge 启动中...
Claude 模型: claude-opus-4-7
微信 API: https://ilinkai.weixin.qq.com
开始长轮询...
```

现在可以在微信上给你的 Bot 发消息了。

## 配置说明

| 环境变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 是 | - | Anthropic API Key |
| `WECHAT_TOKEN` | 是 | - | 微信 Bot Token（扫码获取） |
| `WECHAT_USER_ID` | 是 | - | 微信 ilink 用户 ID |
| `WECHAT_BASE_URL` | 否 | `https://ilinkai.weixin.qq.com` | 微信 API 地址 |
| `CLAUDE_MODEL` | 否 | `claude-opus-4-7` | Claude 模型 |
| `CLAUDE_SYSTEM_PROMPT` | 否 | `你是一个通过微信回复消息的AI助手...` | 系统提示词 |
| `MAX_HISTORY` | 否 | `20` | 每会话最大历史消息数 |
| `CLAUDE_MAX_TOKENS` | 否 | `4096` | Claude 最大输出 token |
| `LOG_LEVEL` | 否 | `INFO` | 日志级别 DEBUG/INFO/WARN/ERROR |

## Token 过期处理

微信 Token 有有效期。过期时服务会自动停止并输出提示：

```
Session 过期 (errcode: -14)，请重新扫码登录并更新 .env 中的 WECHAT_TOKEN
```

重新执行步骤 1 中的扫码登录，更新 `.env` 中的 `WECHAT_TOKEN`，然后重启服务即可。

## 项目结构

```
src/
  index.ts            # 入口：配置加载、信号处理、启动轮询
  config.ts           # Zod 校验的环境变量配置
  weixin-types.ts     # 微信 ilink 协议类型定义
  weixin-api.ts       # 微信 HTTP API 客户端
  claude-client.ts    # Anthropic SDK 封装
  session-store.ts    # 内存会话存储（按 session_id 隔离）
  message-handler.ts  # 消息处理编排：接收→typing→Claude→发送
  poller.ts           # 长轮询循环（指数退避重连）
  logger.ts           # 结构化 JSON 日志
```

## 注意事项

- 微信协议使用 AES-128-ECB 加密传输媒体文件，本版本仅支持文本消息
- 会话历史存储在内存中，重启后对话上下文会清空
- 建议使用 `pm2` 或 `systemd` 管理进程以实现自动重启