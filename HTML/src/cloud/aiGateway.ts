/**
 * SSIO AI 网关客户端 —— StarTasks AI 助手的模型通道。
 *
 * 端点：POST {SSIO}/v1/ai/chat/completions（SSE 流式，末尾服务端补 usage 帧 + [DONE]）
 * 鉴权：X-API-Key（scope: ai:chat, ai:read）
 * 能力：文本流式 + **function calling（工具调用）**——AI 可调用本软件模块（见 ../ai/tools.ts）。
 *
 * Key 策略：默认用内置应用 Key（开箱即用）；用户可在设置里覆盖 baseUrl/key/model。
 */
import { getSsioConfig, SSIO_LIVE_READONLY_KEY } from './ssioClient';

/** 星芒网站 OpenAI 兼容 AI 网关（钱包 sk-sm- Key 走这里） */
export const SITE_AI_BASE = 'https://nrsc.games/api/ai/v1';
import type { HttpFn } from './ssioClient';

/**
 * AI Key：默认复用应用自己的 SSIO Key（`getSsioConfig().apiKey`），
 * 不再写死另一把 bigfish 的 Key —— 那把一旦被吊销/换权限，AI 就整条断掉，
 * 而且排查时根本看不出来用的是哪把。
 */
export const AI_DEFAULT_KEY = ''; // 空 = 用应用配置的 Key
/**
 * 模型 id 以**网站**（nrsc.games/api/ai）为准：
 *   deepseek-v4.1-flash（极速）/ deepseek-v4-pro（深度推理）/ mimo-v2.6-*（小米，视配置开放）
 * 之前为 SSIO 网关写的 deepseek-flash 在网站侧不存在，会 400。
 */
export const AI_DEFAULT_MODEL = 'deepseek-v4.1-flash';
/** 历史配置里的旧名 → 网站侧现行 id */
const MODEL_ALIASES: Record<string, string> = {
  'deepseek-flash': 'deepseek-v4.1-flash',
  'deepseek-v4-flash': 'deepseek-v4.1-flash',
  'deepseek-v4.1-pro': 'deepseek-v4-pro',
};

/**
 * Key 清洗：HTTP 头只接受 ISO-8859-1，混入中文/全角符号/零宽字符时
 * 浏览器会直接抛 `Failed to construct 'Headers': String contains non ISO-8859-1 code point`。
 * 这里只保留可见 ASCII（Key 本身不会包含其他字符）。
 */
export function sanitizeKey(k?: string | null): string {
  return String(k || '').replace(/[^\x21-\x7E]/g, '');
}

export function normalizeModel(model?: string | null): string {
  const m = (model || '').trim();
  if (!m) return AI_DEFAULT_MODEL;
  return MODEL_ALIASES[m] || m;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface AiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface AiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_cny?: number;
}

export interface AiStreamHandlers {
  onText?: (delta: string) => void;
  onToolCalls?: (calls: Array<{ id: string; name: string; arguments: string }>) => void;
  onUsage?: (usage: AiUsage) => void;
}

let httpImpl: HttpFn | null = null;
let aiBaseUrl: string | null = null;
let aiKey = AI_DEFAULT_KEY;
let aiModel = AI_DEFAULT_MODEL;

export function configureAiGateway(opts: { http: HttpFn; baseUrl?: string; key?: string; model?: string }): void {
  httpImpl = opts.http;
  if (opts.baseUrl) aiBaseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.key) aiKey = sanitizeKey(opts.key);
  // 模型名统一走归一化：旧配置里存的 deepseek-v4-flash 在服务端已不开放
  if (opts.model) aiModel = normalizeModel(opts.model);
}

/** 实际用于请求的 Key：用户覆盖 > 应用配置 > 内置 */
function effectiveKey(): string {
  return sanitizeKey(aiKey) || sanitizeKey(getSsioConfig().apiKey) || AI_DEFAULT_KEY;
}

/** 实际用于请求的模型（含旧名迁移） */
export function effectiveModel(): string {
  return normalizeModel(aiModel);
}

/** 直接设置覆盖 Key（传空 = 清除覆盖，回到应用内置 Key） */
export function setAiKey(k?: string | null): void {
  aiKey = sanitizeKey(k);
}

/** 当前凭据来源（排障用）：自定义 Key / 网站登录态 / 无 */
export function aiKeyInfo(): { source: 'custom' | 'site' | 'none'; tail: string } {
  const custom = sanitizeKey(aiKey);
  if (custom) return { source: 'custom', tail: custom.slice(-4) };
  if (siteToken) return { source: 'site', tail: siteToken.slice(-4) };
  return { source: 'none', tail: '' };
}

/** 网站登录态（JWT）：登录后直接走站内对话入口，不需要另签 Key */
let siteToken = '';
export function setSiteToken(t?: string | null): void {
  siteToken = sanitizeKey(t);
}

/**
 * 目标网关（已彻底移除 SSIO AI 网关，全部走星芒网站，扣用户自己的 tokens）：
 *   1) 用户填了 Key（sk-sm-…）      → /api/ai/v1/chat/completions        + Bearer Key
 *   2) 没填 Key 但已登录网站账号    → /api/ai/compat/v1/chat/completions + Bearer JWT
 *   3) 两者都没有                   → 明确报错，指导去钱包签发或登录
 */
function resolveTarget(): { url: string; auth: Record<string, string> } {
  const custom = sanitizeKey(aiKey);
  if (custom) {
    const base = (aiBaseUrl || SITE_AI_BASE).replace(/\/+$/, '');
    return { url: `${base}/chat/completions`, auth: { Authorization: `Bearer ${custom}` } };
  }
  if (siteToken) {
    const base = (aiBaseUrl || 'https://nrsc.games/api/ai/compat/v1').replace(/\/+$/, '');
    return { url: `${base}/chat/completions`, auth: { Authorization: `Bearer ${siteToken}` } };
  }
  throw new Error('未配置 AI 凭据：请在「设置 → AI」填入钱包签发的 Key（sk-sm-…），或先登录星芒网站账号');
}

/**
 * 流式对话（SSE）。支持 tools（function calling）：
 * 服务端把 tool_calls 以增量帧推回，本函数聚合后经 onToolCalls 交调用方执行。
 */
export async function aiChatStream(
  messages: AiChatMessage[],
  handlers: AiStreamHandlers,
  opts: { tools?: AiToolDef[]; model?: string; signal?: AbortSignal } = {},
): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: string }>; usage: AiUsage | null }> {
  if (!httpImpl) throw new Error('AI 网关传输未初始化');
  const body = JSON.stringify({
    model: normalizeModel(opts.model || aiModel),
    messages,
    stream: true,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
  });

  const t = resolveTarget();
  if (/[^\x20-\x7E]/.test(t.url)) {
    throw new Error('AI 网关地址含非 ASCII 字符（中文/全角符号），请到设置里改成纯英文地址');
  }

  let res;
  try {
    res = await httpImpl!({
      method: 'POST',
      url: t.url,
      headers: {
        ...t.auth,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body,
      timeoutMs: 120_000,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/ISO-8859-1/i.test(msg)) {
      throw new Error('请求头含非法字符（Key 或网关地址里有中文/全角符号）—— 请重新粘贴纯英文 Key，或留空使用内置网关');
    }
    throw e;
  }
  if (res.status !== 200) {
    const text = await res.bodyText().catch(() => '');
    // 带上真实地址：用户能据此对照服务端日志，判断请求到底有没有到
    throw new Error(`AI 网关 HTTP ${res.status} @ ${t.url}: ${text.slice(0, 200)}`);
  }

  // SSE 解析：data: {...} / data: [DONE]；工具调用按 index 聚合
  const raw = await res.bodyText();
  let content = '';
  const toolMap = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: AiUsage | null = null;

  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') break;
    let j: any;
    try { j = JSON.parse(payload); } catch { continue; }
    if (j.usage) {
      usage = j.usage;
      handlers.onUsage?.(j.usage);
    }
    const delta = j.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      handlers.onText?.(delta.content);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolMap.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolMap.set(idx, cur);
      }
    }
  }
  const toolCalls = [...toolMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  if (toolCalls.length) handlers.onToolCalls?.(toolCalls);
  return { content, toolCalls, usage };
}

/** 非流式便捷封装（AI 识别 xls 等一次性调用用） */
export async function aiComplete(
  messages: AiChatMessage[],
  opts: { tools?: AiToolDef[]; model?: string; json?: boolean } = {},
): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: string }>; usage: AiUsage | null }> {
  return aiChatStream(messages, {}, opts);
}
