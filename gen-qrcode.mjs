// 临时脚本：启动 openclaw 登录，提取二维码链接，生成 SVG 文件
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const proc = spawn("openclaw", ["channels", "login", "--channel", "openclaw-weixin"], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let buffer = "";

function extractUrl(text) {
  // 匹配 "若二维码未能显示或无法使用，你可以访问以下链接以继续：" 后面的 URL
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("liteapp.weixin.qq.com") || lines[i].includes("访问以下链接")) {
      // 找到后面包含 URL 的行
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        const urlMatch = lines[j].match(/https:\/\/liteapp\.weixin\.qq\.com\/q\/[^\s]+/);
        if (urlMatch) return urlMatch[0];
      }
    }
  }
  return null;
}

async function generateSVG(url, attempt) {
  const filepath = "F:/work/claude-wechat-bridge/qrcode.svg";
  const svg = await QRCode.toString(url, {
    type: "svg",
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  writeFileSync(filepath, svg);
  console.log(`[attempt ${attempt}] QR code SVG saved to: ${filepath}`);
  console.log(`URL: ${url}`);
}

let attempt = 0;

proc.stdout.on("data", (data) => {
  const text = data.toString();
  buffer += text;
  process.stdout.write(text);

  const url = extractUrl(text);
  if (url) {
    attempt++;
    generateSVG(url, attempt).catch(console.error);
  }
});

proc.stderr.on("data", (data) => {
  process.stderr.write(data);
});

proc.on("close", (code) => {
  console.log(`Process exited with code ${code}`);
  process.exit(code || 0);
});

// 超时自动退出
setTimeout(() => {
  console.log("\nTimeout - stopping...");
  proc.kill();
  process.exit(1);
}, 180_000);