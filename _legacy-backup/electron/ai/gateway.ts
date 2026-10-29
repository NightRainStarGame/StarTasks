/**
 * AI 网关客户端（P0）
 *
 * 走网站开放平台：POST {baseUrl}/chat/completions（OpenAI 兼容，SSE 流式）
 * baseUrl 默认 https://nrsc.games/api/ai/v1（Bearer sk-sm-…）
 *
 * 🔴 三条硬约束（都来自 2026-10-18 的安全审计与真机事故）：
 *   1. Key 只在主进程解密使用，渲染层永远拿不到明文 → 本文件不 export 任何打印 key 的函数。
 *   2. 错误必须分类：402 要能读出 sm_balance / sm_required 给用户看，而不是抛出 "HTTP 402"。
 *   3. 流式读取必须可取消（用户点「停止」要真的断流），否则桌面上会挂着看不见的连接。
 */
import { net } from 'electron';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiErrorCode =
  | 'INVALID_KEY'        // 401
  | 'MODEL_NOT_ALLOWED'  // 403
  | 'INSUFFICIENT_TOKENS'// 402
  | 'CONTEXT_OVERFLOW'   // 413
  | 'RATE_LIMITED'       // 429
  | 'UPSTREAM_ERROR'     // 5xx
  | 'NETWORK'            // 断网 / DNS / 超时
  | 'ABORTED'            // 用户取消
  | 'UNKNOWN';

export class AiError extends Error {
  code: AiErrorCode;
  status?: number;
  /** 402 时：当前余额 / 本次预计需要 */
  balance?: number;
  required?: number;

  constructor(code: AiErrorCode, message: string, extra?: { status?: number; balance?: number; required?: number }) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = extra?.status;
    this.balance = extra?.balance;
    this.required = extra?.required;
  }
}

export interface ChatOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface ChatResult {
  text: string;
  usage?: { charged?: number; balance?: number; promptTokens?: number; completionTokens?: number };
}

const DEFAULT_BASE = 'https://nrsc.games/api/ai/v1';
/** 首包超时：超过这个时间还没收到任何字节就判网络问题（首包通常 < 3s） */
const FIRST_BYTE_TIMEOUT_MS = 30_000;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** 把 HTTP 失败翻译成可读的 AiError（含 402 的余额信息） */
async function toAiError(res: Response): Promise<AiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 非 JSON 响应：下面按状态码兜底 */
  }
  const errObj = (body.error ?? {}) as Record<string, unknown>;
  const message = String(errObj.message ?? body.message ?? `HTTP ${res.status}`);
  const code = String(errObj.code ?? '');

  if (res.status === 401) return new AiError('INVALID_KEY', 'API Key 无效或已停用，请到设置里重新填写', { status: 401 });
  if (res.status === 402) {
    return new AiError('INSUFFICIENT_TOKENS', message, {
      status: 402,
      balance: Number(body.sm_balance ?? 0),
      required: Number(body.sm_required ?? 0),
    });
  }
  if (res.status === 403 || code === 'MODEL_NOT_ALLOWED') {
    return new AiError('MODEL_NOT_ALLOWED', '这个 Key 不允许使用该模型', { status: res.status });
  }
  if (res.status === 413 || code === 'CONTEXT_OVERFLOW') {
    return new AiError('CONTEXT_OVERFLOW', '上下文超长了，换个问法或清空对话再试', { status: 413 });
  }
  if (res.status === 429) return new AiError('RATE_LIMITED', '发送太频繁，稍等几秒', { status: 429 });
  if (res.status >= 500) return new AiError('UPSTREAM_ERROR', '模型服务暂时不可用，稍后再试', { status: res.status });
  return new AiError('UNKNOWN', message, { status: res.status });
}

/**
 * 发起一轮流式对话。返回完整文本与计费帧。
 * 取消：传入的 signal 被 abort 时抛 AiError('ABORTED')。
 */
export async function chatStream(opts: ChatOptions): Promise<ChatResult> {
  const base = (opts.baseUrl || DEFAULT_BASE).trim();
  const controller = new AbortController();
  let firstByteTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
  const onOuterAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);

  let usage: ChatResult['usage'];
  let text = '';
  let gotFirstByte = false;

  try {
    let res: Response;
    try {
      res = (await net.fetch(joinUrl(base, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          max_tokens: opts.maxTokens ?? 2048,
          messages: opts.messages,
        }),
        signal: controller.signal,
      } as RequestInit)) as unknown as Response;
    } catch (e) {
      if (opts.signal?.aborted) throw new AiError('ABORTED', '已取消');
      throw new AiError('NETWORK', '连不上星芒网关，检查网络后重试');
    }

    if (!res.ok) throw await toAiError(res);
    if (!res.body) throw new AiError('UNKNOWN', '服务端没有返回数据流');

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!gotFirstByte) {
        gotFirstByte = true;
        if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = null; }
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE：按行切，保留最后半行
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue; // 半个 JSON：丢掉，不要因为一行坏数据中断整个回答
        }
        // 计费帧：优先 sm_usage（平台自定义），退回 OpenAI 标准 usage
        // （Key 流式路径 2026-10-18 之前只发标准 usage，两个都要认）
        const sm = json.sm_usage as Record<string, unknown> | undefined;
        const std = json.usage as Record<string, unknown> | undefined;
        const u = sm ?? std;
        if (u) {
          const pt = Number(u.prompt_tokens ?? 0);
          const ct = Number(u.completion_tokens ?? 0);
          usage = {
            charged: Number(u.charged_tokens ?? u.charged ?? pt + ct),
            balance: Number(u.balance ?? 0),
            promptTokens: pt,
            completionTokens: ct,
          };
        }
        const delta = (json.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          opts.onDelta?.(delta);
        }
      }
    }
    return { text, usage };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (opts.signal?.aborted || (e as Error)?.name === 'AbortError') throw new AiError('ABORTED', '已取消');
    throw new AiError('UNKNOWN', (e as Error)?.message || '未知错误');
  } finally {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    // 首包超时的 abort 也走这里：上层拿到的是 ABORTED / NETWORK
  }
}

/** 连通性自检：拉一次模型清单（公开接口，但仍带 Key 验证鉴权链路） */
export async function probe(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; models: string[]; message: string }> {
  const base = (baseUrl || DEFAULT_BASE).trim();
  try {
    const res = (await net.fetch(joinUrl(base, '/models'), {
      headers: { Authorization: `Bearer ${apiKey}` },
    } as RequestInit)) as unknown as Response;
    if (!res.ok) {
      const err = await toAiError(res);
      return { ok: false, models: [], message: err.message };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map((m) => m.id);
    return { ok: true, models, message: `连通正常，可用模型 ${models.length} 个` };
  } catch {
    return { ok: false, models: [], message: '连不上网关，检查网络或 Base URL' };
  }
}
