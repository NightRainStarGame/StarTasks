/**
 * 问 AI（P0：只读问答）
 *
 * 边界（与 docs/AI-AGENT-PLAN.md v2 §5 一致）：
 *   · 只读：不调用任何写接口，不改用户数据；
 *   · 隐私开关是硬开关：关着连请求都不发；
 *   · 透明：可以点「这次会发什么」看到完整摘要；
 *   · 402 不内嵌支付：给余额缺口 + 跳钱包链接。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { Sparkles, Settings2, Eye, EyeOff, Send, Square, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import dotWave from '@/assets/dot-wave.gif';

interface Msg { role: 'user' | 'assistant'; content: string }

interface AiCfg {
  hasKey: boolean; keyTail: string; insecure: boolean;
  model: string; privacyOn: boolean; baseUrl: string;
}

// 必须与网站 /api/ai 开放的模型 id 一致（见 Web/server/services/aiGateway.js）
const MODELS = [
  { id: 'deepseek-v4.1-flash', label: 'V4.1 Flash（快、便宜）' },
  { id: 'deepseek-v4-pro', label: 'V4 Pro（深度推理）' },
  { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash（高性价比）' },
];

const SUGGESTIONS = ['这周还有什么没交？', '最近有什么考试？', '这周还剩哪些任务？'];

export default function AiChat({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AiCfg | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [busyCfg, setBusyCfg] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; models: string[] } | null>(null);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<{ code: string; message: string; balance?: number; required?: number } | null>(null);
  const [usage, setUsage] = useState<{ charged?: number; balance?: number; tokens?: number } | null>(null);

  const [snapOpen, setSnapOpen] = useState(false);
  /**
   * P1：模型建议的写操作，等用户点确认才落库。
   * 支持**一次多个**（模型可以在一条回复里给多张卡片）。
   */
  const [pendingList, setPendingList] = useState<Array<{ action: any; plan: any }>>([]);
  const pendingRef = useRef<Array<{ action: any; plan: any }>>([]);
  useEffect(() => { pendingRef.current = pendingList; }, [pendingList]);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 历史对话是否已载入（避免刚打开时用空数组覆盖掉已保存的记录） */
  const historyLoaded = useRef(false);
  /** P2：删除后的 30 秒撤销窗口 */
  const [undo, setUndo] = useState<{ token: string; label: string; left: number } | null>(null);
  const [callsOpen, setCallsOpen] = useState(false);
  const [calls, setCalls] = useState<Array<{ ts: number; model: string; charged_tokens: number; status: string; error_code: string }>>([]);
  const [snap, setSnap] = useState<{ text: string; tokens: number } | null>(null);

  const reqIdRef = useRef<string>('');
  const listRef = useRef<HTMLDivElement>(null);

  const loadCfg = useCallback(async () => {
    const c = await window.taskAPI.ai.config.get();
    setCfg(c);
    if (!c.hasKey || !c.privacyOn) setShowCfg(true);
  }, []);

  useEffect(() => { void loadCfg(); }, [loadCfg]);

  // 载入历史对话：关闭窗口 / 重启后仍能接着聊
  useEffect(() => {
    (async () => {
      try {
        const h = await window.taskAPI.ai.history.get();
        if (h?.messages?.length) setMsgs(h.messages as Msg[]);
      } catch { /* 无历史或接口不可用 */ }
      historyLoaded.current = true;
    })();
  }, []);

  // 保存（防抖 700ms）：必须等历史载入完成，否则一打开就用空数组覆盖掉记录
  useEffect(() => {
    if (!historyLoaded.current) return;
    const t = setTimeout(() => {
      void window.taskAPI.ai.history.save(msgs.filter((m) => m.content)).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [msgs]);

  /* 流式事件订阅：按 requestId 过滤，避免多窗口/重开后串台 */
  useEffect(() => {
    const offDelta = window.taskAPI.ai.onDelta((p) => {
      if (p.requestId !== reqIdRef.current) return;
      setMsgs((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + p.text };
        else next.push({ role: 'assistant', content: p.text });
        return next;
      });
    });
    const offDone = window.taskAPI.ai.onDone((p) => {
      if (p.requestId !== reqIdRef.current) return;
      setStreaming(false);
      setUsage({ charged: p.usage?.charged, balance: p.usage?.balance, tokens: p.tokens });
    });
    const offErr = window.taskAPI.ai.onError((p) => {
      if (p.requestId !== reqIdRef.current) return;
      setStreaming(false);
      if (p.code === 'ABORTED') {
        setMsgs((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && !last.content.trim()) next[next.length - 1] = { ...last, content: '（已停止）' };
          return next;
        });
        return;
      }
      setErr({ code: p.code, message: p.message, balance: p.balance, required: p.required });
      // 把失败原因写进那条空气泡，避免"只有提问没有回复"
      setMsgs((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content.trim()) {
          next[next.length - 1] = { ...last, content: `⚠️ ${p.message || '请求失败'}` };
        }
        return next;
      });
    });
    const offAct = window.taskAPI.ai.onAction((p) => {
      if (p.requestId !== reqIdRef.current) return;
      /* 正文里那段 json 块不展示给用户，用服务端剥好的 cleanText 覆盖最后一条 */
      if (p.cleanText) {
        setMsgs((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === 'assistant') { next[i] = { role: 'assistant', content: p.cleanText }; break; }
          }
          return next;
        });
      }
      // 追加一张卡片（同一条回复可能带来多张）
      const idx = pendingRef.current.length;
      const planStub = { ok: true, diff: [] as any[] };
      setPendingList((prev) => [...prev, { action: p.action, plan: planStub }]);
      setActionMsg(null);
      void window.taskAPI.ai.plan(p.action)
        .then((r) => setPendingList((prev) => prev.map((it, i) => (i === idx ? { ...it, plan: r } : it))))
        .catch(() => { /* 预演失败就保留本地 diff */ });
    });
    return () => { offDelta(); offDone(); offErr(); offAct(); };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, streaming]);

  const saveCfg = async (patch: Partial<AiCfg> & { key?: string }) => {
    setBusyCfg(true);
    setTestResult(null);
    try {
      const c = await window.taskAPI.ai.config.save(patch);
      setCfg(c);
      if (patch.key !== undefined) setKeyInput('');
      return c;
    } finally {
      setBusyCfg(false);
    }
  };

  const runTest = async () => {
    setBusyCfg(true);
    setTestResult(null);
    try {
      const r = await window.taskAPI.ai.test();
      setTestResult(r);
    } finally {
      setBusyCfg(false);
    }
  };

  const openSnapshot = async () => {
    if (!snap) {
      const s = await window.taskAPI.ai.snapshot();
      setSnap({ text: s.text, tokens: s.tokens });
    }
    setSnapOpen((v) => !v);
  };

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setErr(null);
    setUsage(null);
    setInput('');
    const history: Msg[] = [...msgs, { role: 'user', content: q }];
    // 先放一个空的 assistant 气泡：请求失败（401/402/网络）时也能看到"AI 这一侧"的反馈，
    // 而不是只有用户提问、下面空空一片（之前就是这个表现）。
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    reqIdRef.current = id;
    try {
      const r = await window.taskAPI.ai.chat({ requestId: id, messages: history.slice(-8) });
      if (!r.started) setStreaming(false);
    } catch (e) {
      setStreaming(false);
      setErr({ code: 'IPC', message: (e as Error).message || '调用失败' });
    }
  };

  const stop = () => {
    if (reqIdRef.current) void window.taskAPI.ai.cancel(reqIdRef.current);
    setStreaming(false);
  };

  const confirmOne = async (index: number) => {
    const item = pendingRef.current[index];
    if (!item) return;
    try {
      const r = await window.taskAPI.ai.confirm(item.action);
      setActionMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setPendingList((prev) => prev.filter((_, i) => i !== index));
        if (r.undo) setUndo({ token: r.undo.token, label: r.undo.label, left: r.undo.seconds || 30 });
      }
    } catch (e) {
      setActionMsg({ ok: false, text: (e as Error).message || '执行失败' });
    }
  };

  /** 全部确认：逐条执行，统计成功数 */
  const confirmAll = async () => {
    let ok = 0;
    const failed: string[] = [];
    for (const item of [...pendingRef.current]) {
      try {
        const r = await window.taskAPI.ai.confirm(item.action);
        if (r.ok) ok += 1;
        else failed.push(r.message || '失败');
      } catch (e: any) {
        failed.push(e?.message || String(e));
      }
    }
    setActionMsg({ ok: !failed.length, text: `已写入 ${ok} 项${failed.length ? `，失败 ${failed.length} 项：${failed[0]}` : ''}` });
    setPendingList([]);
  };

  const doUndo = async () => {
    if (!undo) return;
    const r = await window.taskAPI.ai.undo(undo.token);
    setActionMsg({ ok: r.ok, text: r.message });
    setUndo(null);
  };

  /* 撤销倒计时：到 0 自动收起按钮 */
  useEffect(() => {
    if (!undo) return undefined;
    const t = setInterval(() => {
      setUndo((u) => {
        if (!u) return null;
        const left = u.left - 1;
        return left <= 0 ? null : { ...u, left };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [undo?.token]);   // 只在换 token 时重建定时器

  const loadCalls = async () => {
    const list = await window.taskAPI.ai.calls(10);
    setCalls(list as any);
    setCallsOpen((v) => !v);
  };

  const ready = cfg?.hasKey && cfg?.privacyOn;
  const lastAssistant = useMemo(() => [...msgs].reverse().find((m) => m.role === 'assistant'), [msgs]);

  return (
    <Modal title="问 AI" onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        {/* 顶部状态条 */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <Sparkles size={14} className={ready ? 'text-neon-green' : 'text-text-dim'} />
          {cfg?.hasKey ? (
            <span className="text-text-dim">Key ••••{cfg.keyTail}</span>
          ) : (
            <span className="text-yellow-400">未配置 Key</span>
          )}
          <span className={cfg?.privacyOn ? 'text-neon-green' : 'text-text-dim'}>
            {cfg?.privacyOn ? 'AI 已开启' : 'AI 已关闭'}
          </span>
          <span className="text-text-dim">{cfg?.model ?? ''}</span>
          <button
            onClick={() => setShowCfg((v) => !v)}
            className="ml-auto flex items-center gap-1 text-text-dim hover:text-neon-green transition-colors"
          >
            <Settings2 size={13} /> 设置
          </button>
          <button
            onClick={loadCalls}
            className="flex items-center gap-1 text-text-dim hover:text-neon-green transition-colors"
            title="最近 10 次调用"
          >
            {callsOpen ? <EyeOff size={13} /> : <Eye size={13} />} 调用明细
          </button>
          <button
            onClick={async () => {
              if (!confirm('清空与 AI 的历史对话？')) return;
              await window.taskAPI.ai.history.clear().catch(() => {});
              setMsgs([]);
              setPendingList([]);
            }}
            className="flex items-center gap-1 text-text-dim hover:text-neon-danger transition-colors"
            title="清空历史对话"
          >
            清空对话
          </button>
          <button
            onClick={openSnapshot}
            className="flex items-center gap-1 text-text-dim hover:text-neon-green transition-colors"
            title="查看这次会把什么发给模型"
          >
            {snapOpen ? <EyeOff size={13} /> : <Eye size={13} />} 发送内容
          </button>
        </div>

        {/* 设置面板 */}
        {showCfg && (
          <div className="rounded-lg border border-neon-green/15 bg-ink-base/50 p-3 space-y-3">
            <div>
              <p className="label-tag mb-1">隐私开关</p>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.privacyOn)}
                  onChange={(e) => void saveCfg({ privacyOn: e.target.checked })}
                  className="accent-neon-green"
                />
                允许把课业摘要（不含学号/手机号）发给模型
              </label>
              <p className="text-[10px] text-text-dim mt-1">
                关闭时 AI 完全不可用；数据经 nrsc.games 转发给模型，不会上传附件与原始数据库。
              </p>
            </div>

            <div>
              <p className="label-tag mb-1">API Key（可选 · 留空则直接用网站账号额度）</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={cfg?.hasKey ? `已保存 ••••${cfg.keyTail}，输入新的可替换` : 'sk-sm-…'}
                  className="flex-1 rounded border border-neon-green/20 bg-ink-900/60 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-neon-green"
                />
                <button
                  onClick={() => void saveCfg({ key: keyInput })}
                  disabled={busyCfg || !keyInput.trim()}
                  className="btn-neon text-xs px-3 disabled:opacity-40"
                >
                  保存
                </button>
                <button onClick={runTest} disabled={busyCfg} className="btn-ghost text-xs px-3 disabled:opacity-40">
                  测试
                </button>
              </div>
              {cfg?.insecure && (
                <p className="text-[10px] text-yellow-400 mt-1">
                  ⚠ 当前系统不支持加密存储，Key 以明文保存在本地数据库，请勿在共享电脑上使用。
                </p>
              )}
              {testResult && (
                <p className={`text-[10px] mt-1 flex items-center gap-1 ${testResult.ok ? 'text-neon-green' : 'text-red-400'}`}>
                  {testResult.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {testResult.message}
                </p>
              )}
              {/* WebView 里 <a target="_blank"> 是空操作，必须走 opener 插件打开系统浏览器 */}
              <button
                type="button"
                onClick={() => { void window.taskAPI.updater.openExternal('https://nrsc.games/profile/wallet'); }}
                className="text-[10px] text-neon-green/80 hover:text-neon-green inline-flex items-center gap-1 mt-1"
              >
                去钱包签发 Key / 充值 tokens <ExternalLink size={10} />
              </button>
              <p className="text-[10px] text-text-dim mt-1 leading-relaxed">
                两种用法二选一：① 不填 Key，登录星芒账号后自动用账号额度；② 在钱包签发 <span className="font-mono">sk-sm-…</span> Key 填在这里。
              </p>
            </div>

            <div>
              <p className="label-tag mb-1">模型</p>
              <select
                value={cfg?.model ?? MODELS[0].id}
                onChange={(e) => void saveCfg({ model: e.target.value })}
                className="w-full rounded border border-neon-green/20 bg-ink-900/60 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-neon-green"
              >
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* 发送内容预览 */}
        {snapOpen && (
          <div className="rounded-lg border border-neon-green/15 bg-black/40 p-2">
            <p className="text-[10px] text-text-dim mb-1">
              即将发送的摘要 · 约 {snap?.tokens ?? '…'} tokens
            </p>
            <pre className="text-[10px] leading-relaxed text-text-secondary max-h-40 overflow-auto whitespace-pre-wrap font-mono">
              {snap?.text ?? '加载中…'}
            </pre>
          </div>
        )}

        {/* 调用明细 */}
        {callsOpen && (
          <div className="rounded-lg border border-neon-green/15 bg-black/40 p-2">
            <p className="text-[10px] text-text-dim mb-1">最近 {calls.length} 次调用（只记量与结果，不存内容）</p>
            <div className="space-y-0.5 max-h-32 overflow-auto">
              {calls.length === 0 && <p className="text-[10px] text-text-dim">还没有记录</p>}
              {calls.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-text-secondary">
                  <span className="text-text-dim">{new Date(c.ts).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span className="truncate">{c.model}</span>
                  <span className={c.status === 'ok' ? 'text-neon-green' : 'text-red-400'}>
                    {c.status === 'ok' ? `${c.charged_tokens} tk` : c.error_code}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 动作确认卡片（P1：唯一会写库的入口）——支持一次多张 */}
        {pendingList.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-cyan-200 flex items-center gap-1">
              <Sparkles size={12} />
              AI 想执行 {pendingList.length} 个操作，逐条确认后才写库
            </p>
            {pendingList.map((item, i) => (
              <div key={i} className="rounded-lg border border-cyan-400/40 bg-cyan-400/5 p-3 space-y-2">
                <p className="text-[11px] text-cyan-200">{item.action.label || item.action.kind || '待确认操作'}</p>
                <div className="space-y-1">
                  {(item.plan?.diff?.length ? item.plan.diff : item.action.diff || []).map((d: any, k: number) => (
                    <div key={k} className="text-[11px] font-mono flex flex-wrap items-baseline gap-1">
                      <span className="text-text-dim w-14 shrink-0">{d.field}</span>
                      {d.before && <span className="text-text-secondary line-through decoration-red-400/60">{d.before}</span>}
                      {d.before && <span className="text-text-dim">→</span>}
                      <span className="text-neon-green">{d.after}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => void confirmOne(i)} className="btn-neon text-xs px-3 py-1.5">确认写入</button>
                  <button
                    onClick={() => setPendingList((prev) => prev.filter((_, k) => k !== i))}
                    className="btn-ghost text-xs px-3 py-1.5"
                  >
                    不要
                  </button>
                </div>
              </div>
            ))}
            {pendingList.length > 1 && (
              <button onClick={() => void confirmAll()} className="btn-neon text-xs w-full py-1.5">
                全部确认（{pendingList.length} 项）
              </button>
            )}
          </div>
        )}

        {actionMsg && (
          <p className={`text-[11px] flex items-center gap-1 ${actionMsg.ok ? 'text-neon-green' : 'text-red-400'}`}>
            {actionMsg.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {actionMsg.text}
            {undo && (
              <button onClick={() => void doUndo()} className="ml-1 underline text-neon-green">
                撤销（{undo.left}s）
              </button>
            )}
          </p>
        )}

        {/* 对话区 */}
        <div ref={listRef} className="max-h-[46vh] min-h-[180px] overflow-y-auto space-y-2 pr-1">
          {msgs.length === 0 && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-text-dim">读你的课表/作业/日程来回答；可以帮你建任务或日程，但每次都要你点确认。</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={!ready}
                    className="text-[11px] rounded border border-neon-green/20 px-2.5 py-1 text-text-secondary hover:border-neon-green/60 hover:text-neon-green transition-colors disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-left ${
                  m.role === 'user'
                    ? 'bg-neon-green/10 border border-neon-green/25 text-text-primary'
                    : 'bg-ink-900/70 border border-white/5 text-text-secondary'
                }`}
              >
                {m.content ? (
                  m.content
                ) : streaming ? (
                  // 等待首字时的加载动画（原先是三个点文本）
                  <img src={dotWave} alt="正在回复" className="h-4 w-auto" />
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* 错误卡片 */}
        {err && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs">
            <p className="flex items-center gap-1.5 text-red-300">
              <AlertTriangle size={13} /> {err.message}
            </p>
            {err.code === 'INSUFFICIENT_TOKENS' && (
              <p className="text-text-dim mt-1">
                余额 {(err.balance ?? 0).toLocaleString()}，本次约需 {(err.required ?? 0).toLocaleString()}。
                <a href="https://nrsc.games/profile/wallet" target="_blank" rel="noreferrer" className="text-neon-green ml-1 inline-flex items-center gap-0.5">
                  去充值 <ExternalLink size={10} />
                </a>
              </p>
            )}
            {(err.code === 'NO_KEY' || err.code === 'PRIVACY_OFF' || err.code === 'INVALID_KEY') && (
              <button onClick={() => setShowCfg(true)} className="text-neon-green mt-1 underline">
                打开设置
              </button>
            )}
          </div>
        )}

        {/* 用量回执 */}
        {usage && !streaming && (
          <p className="text-[10px] text-text-dim font-mono">
            {typeof usage.charged === 'number' ? `消耗 ${usage.charged} tokens` : ''}
            {typeof usage.balance === 'number' ? ` · 余额 ${usage.balance.toLocaleString()}` : ''}
            {usage.tokens ? ` · 摘要 ${usage.tokens} tokens` : ''}
            {lastAssistant && usage.tokens && usage.tokens > 1800 ? ' · 摘要已截断' : ''}
          </p>
        )}

        {/* 输入区 */}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={2}
            placeholder={ready ? '问点什么…（Enter 发送，Shift+Enter 换行）' : '先在上方开启 AI 并填入 Key'}
            disabled={!ready || streaming}
            className="flex-1 resize-none rounded-lg border border-neon-green/20 bg-ink-900/60 px-3 py-2 text-xs text-text-primary outline-none focus:border-neon-green disabled:opacity-50"
          />
          {streaming ? (
            <button onClick={stop} className="btn-ghost text-xs px-3 py-2 flex items-center gap-1">
              <Square size={12} /> 停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!ready || !input.trim()}
              className="btn-neon text-xs px-3 py-2 flex items-center gap-1 disabled:opacity-40"
            >
              <Send size={12} /> 发送
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
