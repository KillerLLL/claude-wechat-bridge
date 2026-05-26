# 赛博臭居 - Claude WeChat Bridge 部署指南

把 Claude（或智谱等兼容 API）接入微信的完整流程，基于腾讯 openclaw-weixin 协议。

---

## 前置条件

| 项目 | 要求 |
|---|---|
| Node.js | >= 22 |
| 微信 | >= 8.0.70，已开通 ClawBot 插件 |
| AI API Key | Anthropic 或智谱等兼容 API |

## 架构

```
微信用户发消息 → 微信服务器 → getUpdates 长轮询 → 本服务 → AI API → sendMessage → 微信用户收到回复
```

---

## 第一步：安装 OpenClaw 并获取微信 Token

本服务通过微信 ilink 协议收发消息，需要先用 OpenClaw 扫码获取 Token。Token 获取后本服务即可独立运行，不依赖 OpenClaw。

### 1.1 安装 OpenClaw

```bash
npm install -g openclaw
openclaw --version  # 确认版本 >= 2026.3.22
```

### 1.2 安装微信插件

```bash
npx -y @tencent-weixin/openclaw-weixin-cli install
openclaw config set plugins.entries.openclaw-weixin.enabled true
```

### 1.3 修复配置（如需要）

如果 openclaw 报配置错误，先修复：

```bash
openclaw doctor --fix
openclaw config validate
```

### 1.4 扫码登录

**方式一：终端直接扫码**

```bash
openclaw channels login --channel openclaw-weixin
```

终端会显示二维码，用微信扫：**我 → 设置 → 插件 → ClawBot → 扫码确认**。

**方式二：生成 SVG 二维码（推荐，终端看不清时用）**

如果终端二维码扫不了，用项目里的 `gen-qrcode.mjs` 生成 SVG 文件在浏览器打开：

```bash
cd F:\work\claude-wechat-bridge
npm install   # 确保装了 qrcode 依赖
node gen-qrcode.mjs
# 会生成 qrcode.svg 并自动打开浏览器，扫码即可
# 同时终端会输出备用链接，也可以在手机浏览器打开
```

### 1.5 读取 Token 和 UserId

扫码成功后，凭据保存在：

```bash
# 查看账户文件
ls ~/.openclaw/openclaw-weixin/accounts/

# 读取 token 和 userId
cat ~/.openclaw/openclaw-weixin/accounts/<accountId>.json
```

记下两个字段：
- `token`：类似 `b77d47f64955@im.bot:060000c78cdfc17879d90fbe007e1d2e91281b`
- `userId`：类似 `o9cq80xiOZLRZbHeWPOGrRVLlAEU@im.wechat`

---

## 第二步：配置本服务

### 2.1 创建项目

```bash
# 如果没有项目目录，从零创建：
mkdir -p F:\work\claude-wechat-bridge\src
cd F:\work\claude-wechat-bridge
```

### 2.2 项目文件

需要以下文件（全部在 `F:\work\claude-wechat-bridge\` 下）：

```
package.json          # 项目配置
tsconfig.json         # TypeScript 配置
.env                  # 环境变量（含密钥，不提交 git）
.env.example          # 环境变量模板
.gitignore
gen-qrcode.mjs        # 扫码二维码生成工具
src/
  index.ts            # 入口
  config.ts           # Zod 配置校验
  weixin-types.ts     # 微信协议类型
  weixin-api.ts       # 微信 API 客户端
  claude-client.ts    # AI API 客户端
  session-store.ts    # 会话存储
  message-handler.ts  # 消息处理编排
  poller.ts           # 长轮询循环
  logger.ts           # 日志
```

### 2.3 安装依赖

```bash
cd F:\work\claude-wechat-bridge
npm install
```

### 2.4 配置 .env

```bash
cp .env.example .env
```

编辑 `.env`，填入实际值：

```env
# AI API（支持 Anthropic 或智谱等兼容 API）
ANTHROPIC_API_KEY=你的API密钥
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic   # 智谱用这个，原生 Anthropic 删掉这行

# 微信凭据（扫码获得）
WECHAT_TOKEN=扫码获得的token
WECHAT_USER_ID=扫码获得的userId

# 微信 API（一般不用改）
WECHAT_BASE_URL=https://ilinkai.weixin.qq.com

# AI 模型
CLAUDE_MODEL=glm-5.1

# 性格提示词（可根据需要自定义）
CLAUDE_SYSTEM_PROMPT=你是"赛博臭居"，一只赛博猫猫...

# 运行参数
MAX_HISTORY=20
CLAUDE_MAX_TOKENS=4096
LOG_LEVEL=INFO
```

---

## 第三步：启动

```bash
cd F:\work\claude-wechat-bridge
npm start
```

看到以下日志说明启动成功：

```
Claude-WeChat Bridge 启动中...
Claude 模型: glm-5.1
微信 API: https://ilinkai.weixin.qq.com
开始长轮询...
```

现在在微信上给 Bot 发消息即可收到回复。

---

## 日常运维

### 开机启动

```bash
cd F:\work\claude-wechat-bridge
npm start
```

### Token 过期处理

Token 过期时服务会停止并输出提示。重新扫码：

```bash
# 1. 重新扫码
openclaw channels login --channel openclaw-weixin
# 或用 SVG 工具
node gen-qrcode.mjs

# 2. 读取新 token
cat ~/.openclaw/openclaw-weixin/accounts/<accountId>.json

# 3. 更新 .env 中的 WECHAT_TOKEN 和 WECHAT_USER_ID

# 4. 重启服务
npm start
```

### 修改性格/提示词

编辑 `.env` 中的 `CLAUDE_SYSTEM_PROMPT`，然后重启服务即可。

---

## 踩坑记录

### 1. getUpdates 返回 `ret=undefined`

微信 API 正常响应不包含 `ret` 字段，只有错误时才有。代码中需要用 `ret != null && ret !== 0` 判断，不能写 `ret !== 0`。

### 2. 消息 `message_state: 2 (FINISH)` 被过滤

微信消息到达时 state 已经是 FINISH，不能过滤掉 FINISH 状态的消息，否则所有消息都会被跳过。

### 3. sendMessage 必须包含完整字段

只发 `to_user_id` + `item_list` 会返回 `{}`（HTTP 200）但消息不投递。必须包含：
- `from_user_id: ""`
- `client_id`：随机 ID，格式 `openclaw-weixin-{随机串}`
- `message_type: 2` (BOT)
- `message_state: 2` (FINISH)

### 4. VSCode 终端看不到二维码

终端二维码字符在 VSCode 里显示不全。用 `gen-qrcode.mjs` 生成 SVG 文件在浏览器打开，或复制备用链接到手机浏览器。

### 5. OpenClaw 配置格式错误

`channels.telegram.streaming` 新版要求 object 而非字符串。手动改 `~/.openclaw/openclaw.json`：
```json
"streaming": { "mode": "off" }
```

---

## 协议参考

基于 `@tencent-weixin/openclaw-weixin` v2.4.4 的 ilink Bot 协议：

- API 地址：`https://ilinkai.weixin.qq.com`
- 认证：`AuthorizationType: ilink_bot_token` + `Authorization: Bearer <token>`
- 端点：`ilink/bot/getupdates`、`ilink/bot/sendmessage`、`ilink/bot/getconfig`、`ilink/bot/sendtyping`
- 消息类型：TEXT(1)、IMAGE(2)、VOICE(3)、FILE(4)、VIDEO(5)
- 媒体加密：AES-128-ECB（本版仅支持文本）

源码：https://github.com/Tencent/openclaw-weixin

---

## 快速部署（给别人的精简步骤）

拿到项目代码后，按顺序执行以下命令即可部署：

```bash
# 1. 安装依赖
cd claude-wechat-bridge
npm install

# 2. 安装 OpenClaw（获取微信 Token 必须用）
npm install -g openclaw
npx -y @tencent-weixin/openclaw-weixin-cli install
openclaw config set plugins.entries.openclaw-weixin.enabled true

# 3. 扫码登录（用微信扫：我 → 设置 → 插件 → ClawBot → 扫码确认）
node gen-qrcode.mjs
# 会生成 qrcode.svg，在浏览器打开扫码

# 4. 读取 Token 和 UserId
# 扫码成功后执行：
ls ~/.openclaw/openclaw-weixin/accounts/
# 找到 json 文件，查看里面的 token 和 userId
cat ~/.openclaw/openclaw-weixin/accounts/<accountId>.json

# 5. 配置环境变量
cp .env.example .env
# 编辑 .env，填入以下三项（其他不用改）：
#   ANTHROPIC_API_KEY=你的AI密钥
#   WECHAT_TOKEN=上一步拿到的token
#   WECHAT_USER_ID=上一步拿到的userId

# 6. 启动
npm start
```

**注意：**
- 需要先安装 Node.js >= 22
- AI API Key 需要自己申请（支持智谱、Anthropic 等兼容 API）
- 微信 Token 会过期，过期后重新执行步骤 3-5