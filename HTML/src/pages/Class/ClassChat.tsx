/**
 * 班级聊天 —— 成员间即时消息（含生日祝福卡片）。
 * 增量拉取：进入 Tab 后每 15 秒轮询新消息；发送后本地追加 + 立即拉一次。
 * 消息类型：text（普通） / birthday_wish（生日祝福，meta.to = 寿星昵称）。
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Cake, Gift } from 'lucide-react';
import { toast } from '@/utils/toast';
import { fmtDate, pick } from '@/utils/time';
import { absUrl } from '@/utils/url';

interface Message {
  id: number;
  author_alias: string;
  author_token: string;
  author_avatar?: string;
  body: string;
  type: 'text' | 'birthday_wish';
  meta: string | null;
  created_at: number;
}

interface Props {
  classId: number;
  myAlias: string;
  /** 我的网站头像（老消息没存头像时用它兜底，保证自己的气泡也有头像） */
  myAvatar?: string;
  /** 成员 alias → 头像，老消息没有 author_avatar 时按昵称回填 */
  avatarByAlias?: Record<string, string>;
  /** 外部注入的初始祝福（生日弹窗点「送祝福」后跳过来） */
  pendingWish?: { to: string; text: string } | null;
  onWishSent?: () => void;
}

/** 头像：有网站头像用图，否则彩色首字圆标 */
export function Avatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  // 图裂了要能退回首字圆标：以前 onError 直接 display:none，头像位置就空成一块黑框
  const [broken, setBroken] = useState(false);
  const colors = ['#34C38F', '#00D4FF', '#F39C12', '#9B59B6', '#E74C3C', '#1ABC9C', '#D4A017'];
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  const color = colors[(initial.charCodeAt(0) || 63) % colors.length];
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        className="rounded-full shrink-0 object-cover border border-neon-green/30 ring-1 ring-white/10"
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-bold border border-white/10 ring-1 ring-white/5 shadow-sm"
      style={{ width: size, height: size, background: color, color: '#0A0F0D', fontSize: size * 0.42 }}
      title={name}
    >
      {initial}
    </div>
  );
}

export default function ClassChat({ classId, myAlias, myAvatar, avatarByAlias, pendingWish, onWishSent }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const lastIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = async (append: boolean) => {
    const r = await (window.taskAPI as any).class.listMessages(classId, lastIdRef.current);
    if (r?.ok && Array.isArray(r.messages) && r.messages.length) {
      lastIdRef.current = Math.max(lastIdRef.current, ...r.messages.map((m: Message) => m.id));
      setMessages((prev) => (append ? [...prev, ...r.messages] : r.messages));
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  };

  useEffect(() => {
    lastIdRef.current = 0;
    load(false);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // 生日弹窗注入祝福：自动填入输入框
  useEffect(() => {
    if (pendingWish) {
      setInput(pendingWish.text);
      onWishSent?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWish]);

  const send = async (type: 'text' | 'birthday_wish' = 'text', meta?: any) => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // 带上昵称和头像：消息列表要显示"账号头像 + 昵称"，服务端优先用成员表里的值，
      // 这里再传一份，保证 mock / 老数据也能显示
      const r = await (window.taskAPI as any).class.sendMessage(classId, {
        body: text,
        type,
        meta,
        alias: myAlias,
        avatarUrl: myAvatar || '',
      });
      if (r?.ok) {
        setInput('');
        await load(true);
      } else {
        toast.error(r?.error || '发送失败');
      }
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setBusy(false); }
  };

  return (
    <div className="glass-panel flex flex-col" style={{ minHeight: '420px' }}>
      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ maxHeight: '480px' }}>
        {messages.length === 0 && (
          <div className="text-text-dim font-mono text-xs text-center py-8">
            还没有消息 · 打个招呼吧 👋
          </div>
        )}
        {messages.map((m) => {
          // 服务端 / mock 的字段命名不一致（author_alias vs authorAlias），两种都读
          const alias = pick<string>(m, 'authorAlias', 'author_alias') || '匿名';
          const createdAt = pick<any>(m, 'createdAt', 'created_at');
          const isMe = alias === myAlias;
          // 头像优先级：消息自带 → 成员表按昵称回填 → 自己的网站头像
          const avatarUrl = absUrl(
            pick<string>(m, 'authorAvatar', 'author_avatar') ||
            avatarByAlias?.[alias] ||
            (isMe ? myAvatar : '') ||
            '',
          ) || undefined;
          const isWish = m.type === 'birthday_wish';
          let wishTo: string | null = null;
          try { wishTo = m.meta ? (JSON.parse(m.meta)?.to ?? null) : null; } catch { /* noop */ }
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
              {!isMe && <Avatar name={alias} url={avatarUrl} size={30} />}
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                  isWish
                    ? 'border-2 border-neon-yellow/50 bg-neon-yellow/10'
                    : isMe
                      ? 'bg-neon-green/15 border border-neon-green/30'
                      : 'bg-ink-900/60 border border-neon-green/10'
                }`}
              >
                {/* 昵称：每条都显示（自己的靠右），否则气泡上只剩内容和时间，看着像"没有名字" */}
                <div className={`text-[10px] font-mono mb-0.5 ${isMe ? 'text-right text-neon-green/70' : 'text-text-dim'}`}>
                  {alias}{isMe && ' (我)'}
                </div>
                {isWish && (
                  <div className="flex items-center gap-1 text-[10px] font-mono text-neon-yellow mb-1">
                    <Gift size={11} /> 生日祝福{wishTo ? ` → ${wishTo}` : ''}
                  </div>
                )}
                <div className={`text-xs whitespace-pre-wrap break-words ${isWish ? 'text-neon-yellow' : 'text-text-primary'}`}>
                  {isWish && '🎂 '}{m.body}
                </div>
                <div className="text-[9px] text-text-dim font-mono mt-1 text-right">
                  {fmtDate(createdAt, 'md')} {fmtDate(createdAt, 'hm')}
                </div>
              </div>
              {isMe && <Avatar name={alias} url={avatarUrl} size={30} />}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="p-3 border-t border-neon-green/10 flex items-center gap-2">
        {/* 以谁的身份发言：头像 + 昵称常驻，避免「看不到自己的头像名字」 */}
        <Avatar name={myAlias} url={myAvatar} size={30} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="说点什么…（Enter 发送）"
          className="input-neon flex-1 text-sm"
          maxLength={2000}
        />
        <button onClick={() => send()} disabled={busy || !input.trim()} className="btn-neon px-3 py-2 shrink-0 disabled:opacity-50">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
