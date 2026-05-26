import crypto from "node:crypto";
import type { ImageItem, CDNMedia } from "./weixin-types.js";
import { logger } from "./logger.js";

export interface DecryptedImage {
  base64Data: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

const DEFAULT_MAX_SIZE = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30_000;

function buildDownloadUrl(media: CDNMedia): string | null {
  const base = media.full_url;
  if (!base) return null;
  const param = media.encrypt_query_param;
  if (!param) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${param}`;
}

async function downloadBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function decryptAes128Ecb(encrypted: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function detectMimeType(
  buf: Buffer,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
    return "image/gif";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

function tryParseKey(raw: string): Buffer | null {
  if (!raw) return null;

  // 尝试 hex 解码（32 字符 hex = 16 字节）
  if (/^[0-9a-fA-F]+$/.test(raw)) {
    const hexBuf = Buffer.from(raw, "hex");
    if (hexBuf.length === 16) return hexBuf;
  }

  // 尝试 base64 解码
  try {
    const b64Buf = Buffer.from(raw, "base64");
    if (b64Buf.length === 16) return b64Buf;
  } catch { /* ignore */ }

  return null;
}

function isImageBuffer(buf: Buffer): boolean {
  return detectMimeType(buf) !== null;
}

export async function decryptImage(
  imageItem: ImageItem,
  maxSize = DEFAULT_MAX_SIZE,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<DecryptedImage | null> {
  try {
    // 打印完整 image_item 用于调试
    logger.info("图片消息原始数据", {
      hasMedia: !!imageItem.media,
      hasThumbMedia: !!imageItem.thumb_media,
      aeskey: imageItem.aeskey ? `${imageItem.aeskey.substring(0, 8)}...(len=${imageItem.aeskey.length})` : "(empty)",
      url: imageItem.url ? imageItem.url.substring(0, 200) : "(empty)",
      mediaFullUrl: imageItem.media?.full_url
        ? imageItem.media.full_url.substring(0, 200)
        : "(empty)",
      mediaAesKey: imageItem.media?.aes_key
        ? `${imageItem.media.aes_key.substring(0, 8)}...(len=${imageItem.media.aes_key.length})`
        : "(empty)",
      mediaEncryptQueryParam: imageItem.media?.encrypt_query_param
        ? `${imageItem.media.encrypt_query_param.substring(0, 50)}...(len=${imageItem.media.encrypt_query_param.length})`
        : "(empty)",
    });

    // 策略1: 直接使用 image_item.url（可能是未加密的缩略图 URL）
    if (imageItem.url) {
      logger.info("尝试直接 URL 下载", { url: imageItem.url.substring(0, 200) });
      try {
        const buf = await downloadBuffer(imageItem.url, timeoutMs);
        if (buf.length > 0 && buf.length <= maxSize && isImageBuffer(buf)) {
          const mediaType = detectMimeType(buf)!;
          logger.info("直接 URL 下载成功", { size: buf.length, mediaType });
          return { base64Data: buf.toString("base64"), mediaType };
        }
        logger.info("直接 URL 返回非图片数据", { size: buf.length, head: buf.subarray(0, 16).toString("hex") });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.info("直接 URL 下载失败", { error: msg });
      }
    }

    // 策略2: 使用 CDN media URL + AES 解密
    const media = imageItem.media ?? imageItem.thumb_media;
    if (media) {
      const cdnUrl = buildDownloadUrl(media);
      const rawKey = imageItem.aeskey ?? media.aes_key;

      if (cdnUrl && rawKey) {
        logger.info("尝试 CDN 下载+解密", {
          url: cdnUrl.substring(0, 200),
          keyLen: rawKey.length,
        });

        const key = tryParseKey(rawKey);
        if (key) {
          const encrypted = await downloadBuffer(cdnUrl, timeoutMs);
          logger.info("CDN 下载完成", { size: encrypted.length });

          try {
            const decrypted = decryptAes128Ecb(encrypted, key);
            logger.info("AES 解密完成", { size: decrypted.length });

            if (decrypted.length > maxSize) {
              logger.warn("图片超出大小限制", { size: decrypted.length });
              return null;
            }

            const mediaType = detectMimeType(decrypted);
            if (mediaType) {
              return { base64Data: decrypted.toString("base64"), mediaType };
            }
            logger.warn("解密后非图片格式", {
              head: decrypted.subarray(0, 16).toString("hex"),
            });
          } catch (decErr) {
            const msg = decErr instanceof Error ? decErr.message : String(decErr);
            logger.warn("AES 解密失败", { error: msg });
          }
        } else {
          logger.warn("AES 密钥格式无法解析", { rawKeyPreview: rawKey.substring(0, 16) });
        }
      }

      // 策略3: CDN URL 不解密直接下载试试
      if (cdnUrl) {
        logger.info("尝试 CDN 直接下载（不解密）");
        try {
          const buf = await downloadBuffer(cdnUrl, timeoutMs);
          if (buf.length > 0 && buf.length <= maxSize && isImageBuffer(buf)) {
            const mediaType = detectMimeType(buf)!;
            logger.info("CDN 直接下载成功", { size: buf.length, mediaType });
            return { base64Data: buf.toString("base64"), mediaType };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.info("CDN 直接下载失败", { error: msg });
        }
      }
    }

    logger.warn("所有图片获取策略均失败");
    return null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("图片处理异常", { error: errMsg });
    return null;
  }
}
