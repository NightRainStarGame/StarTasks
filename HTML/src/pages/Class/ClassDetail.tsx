/**
 * 班级详情页（v1.2.9 R6 重构）
 * - tab：总览（含统计，不单独开页）/ 公告（owner+admin 可删除）/ 接龙 / 投票 / 成员（可管理）
 * - v1.2.9 移除「作业」tab：主应用已有作业同步（分享码双源），班级作业功能冗余
 * - 接龙 / 投票：所有成员都可发起与参与（SSIO 内置凭据，开箱即写云端）
 */
import { useEffect, useState } from 'react';
import BirthdayBoard from './BirthdayBoard';
import ClassChat, { Avatar } from './ClassChat';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Megaphone, Users, RefreshCw, Plus, CheckCircle2, Circle,
  Crown, Shield, User as UserIcon, LayoutDashboard, ListChecks, Vote,
  Trash2, Copy, Lock, Clock, TrendingUp, X, Pencil, Cake, Settings,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { toast } from '@/utils/toast';
import { fmtDate } from '@/utils/time';
import { absUrl } from '@/utils/url';
import { getSiteProfile } from '@/features/account/siteProfile';

type Tab = 'overview' | 'announcements' | 'chains' | 'polls' | 'chat' | 'members';

export default function ClassDetailPage() {
  const { id } = useParams();
  const classId = Number(id);
  const nav = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [anns, setAnns] = useState<any[]>([]);
  const [chains, setChains] = useState<any[]>([]);
  const [polls, setPolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 网站账号资料（头像/昵称）——聊天和成员列表用它兜底显示
  const [siteMe, setSiteMe] = useState<{ username: string; avatarUrl: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getSiteProfile().then((p) => {
      if (alive) setSiteMe({ username: p.username, avatarUrl: p.avatarUrl });
    }).catch(() => { /* 未登录就留空 */ });
    return () => { alive = false; };
  }, []);
  // 生日祝福：日历点「送祝福」→ 跳聊天 Tab 并预填祝福语
  const [pendingWish, setPendingWish] = useState<{ to: string; text: string } | null>(null);
  // owner：班级设置弹窗
  const [showClassSettings, setShowClassSettings] = useState(false);
  const [showPublishAnn, setShowAnn] = useState(false);
  const [showCreateChain, setShowChain] = useState(false);
  const [showCreatePoll, setShowPoll] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r1 = await window.taskAPI.class.info(classId);
      if (r1.ok) setInfo(r1);
      const r2 = await window.taskAPI.class.listAnnouncements(classId);
      if (r2.ok) setAnns(r2.announcements);
      const r4 = await window.taskAPI.class.listChains(classId);
      if (r4.ok) setChains(r4.chains);
      const r5 = await window.taskAPI.class.listPolls(classId);
      if (r5.ok) setPolls(r5.polls);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [classId]);

  // 实时同步：前台每 20 秒静默拉一次（手动同步的提示语只在手动触发时显示）
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      (async () => {
        try {
          const r = await window.taskAPI.class.sync(classId);
          if (r.kicked || r.errorCode === 'KICKED') {
            toast.warn('你已被移出该班级');
            nav('/class');
            return;
          }
          if (r.ok) await refresh();
        } catch { /* 静默：网络抖动不打扰 */ }
      })();
    }, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const sync = async () => {
    setSyncing(true); setMsg(null);
    try {
      const r = await window.taskAPI.class.sync(classId);
      if (r.kicked || r.errorCode === 'KICKED') {
        toast.warn('你已被移出该班级');
        nav('/class');
        return;
      }
      if (r.ok) {
        // v1.2.17：后端不再返回 source（曾经它的值是历史遗留的 'github'，显示出来就是句假话）。
        setMsg(`✅ 同步完成 · SSIO 云 · 新增 ${r.newAnnouncements || 0} 公告 / ${r.newChains || 0} 接龙 / ${r.newPolls || 0} 投票`);
        await refresh();
      } else {
        setMsg(`❌ 同步失败：${r.error}`);
      }
    } catch (e: any) { setMsg(`❌ 同步异常：${e?.message || e}`); }
    finally { setSyncing(false); }
  };

  const markRead = async (annId: number) => {
    await window.taskAPI.class.markAnnouncementRead(classId, annId);
    refresh();
  };

  const deleteAnn = async (annId: number) => {
    if (!window.confirm('确定删除这条公告？所有成员同步后都会删除。')) return;
    try {
      const r = await window.taskAPI.class.deleteAnnouncement(classId, annId);
      if (r.ok) { toast.success('公告已删除'); refresh(); }
      else toast.error(r.error || '删除失败');
      if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000);
    } catch (e: any) { toast.error(e?.message || String(e)); }
  };

  // 安全格式化：任何脏数据只显示 '—'，绝不让 toISOString 抛 RangeError 把整页打挂
  const fmt = (ts: any) => fmtDate(ts, 'datetime');

  if (!info) {
    return (
      <div className="p-6">
        <button onClick={() => nav('/class')} className="btn-ghost text-xs mb-4">
          <ArrowLeft size={14} /> 返回班级列表
        </button>
        <div className="text-text-dim font-mono text-xs text-center py-8">{loading ? '加载中…' : '班级不存在'}</div>
      </div>
    );
  }

  const isOwner = info.role === 'owner';
  const isAdmin = info.role === 'admin';
  const canManage = isOwner || isAdmin;
  const unread = anns.filter((a) => !a.isRead).length;
  const openChains = chains.filter((c) => !c.closed).length;
  const openPolls = polls.filter((p) => !p.closed && (!p.deadlineAt || Date.now() < p.deadlineAt)).length;

  return (
    <div className="p-6 space-y-4">
      {/* 顶部 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/class" className="text-text-dim hover:text-neon-green font-mono text-xs flex items-center gap-1 mb-2">
            <ArrowLeft size={12} /> 返回班级列表
          </Link>
          <h1 className="text-2xl font-bold text-neon-green text-glow-green truncate">{info.name}</h1>
          {info.description && (
            <p className="text-text-dim font-mono text-xs mt-1">{info.description}</p>
          )}
          <div className="flex items-center gap-3 text-text-dim font-mono text-[11px] mt-2">
            <span>{info.memberCount}/{info.maxMembers} 成员</span>
            <span>·</span>
            <span>我：<strong className="text-neon-green">{info.myAlias}</strong></span>
            <span>·</span>
            <span className={isOwner ? 'text-neon-yellow' : isAdmin ? 'text-neon-cyan' : 'text-text-secondary'}>{info.role}</span>
          </div>
        </div>
        {/* v1.2.18：flex-wrap + 统一 padding —— 同步/公告/接龙/投票四个按钮在
            ~390px 小屏上必然溢出右侧（shrink-0 禁止收缩），是「UI 对不齐」的头号嫌疑 */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={sync} disabled={syncing} className="btn-ghost text-xs">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            同步
          </button>
          {isOwner && (
            <button onClick={() => setShowClassSettings(true)} className="btn-ghost text-xs" title="编辑班级名称/简介/人数上限">
              <Settings size={14} /> 班级设置
            </button>
          )}
          {canManage && (
            <button onClick={() => setShowAnn(true)} className="btn-ghost text-xs">
              <Plus size={14} /> 公告
            </button>
          )}
          <button onClick={() => setShowChain(true)} className="btn-ghost text-xs">
            <Plus size={14} /> 接龙
          </button>
          <button onClick={() => setShowPoll(true)} className="btn-neon text-xs">
            <Plus size={14} /> 投票
          </button>
        </div>
      </div>

      {msg && (
        <div className="bg-ink-base/60 border border-neon-green/20 rounded p-2 text-xs font-mono">
          {msg}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-neon-green/15 flex-wrap">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<LayoutDashboard size={14} />} label="总览" />
        <TabButton active={tab === 'announcements'} onClick={() => setTab('announcements')} icon={<Megaphone size={14} />} label="公告" badge={unread} />
        <TabButton active={tab === 'chains'} onClick={() => setTab('chains')} icon={<ListChecks size={14} />} label="接龙" badge={openChains} />
        <TabButton active={tab === 'polls'} onClick={() => setTab('polls')} icon={<Vote size={14} />} label="投票" badge={openPolls} />
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<Cake size={14} />} label="聊天" />
        <TabButton active={tab === 'members'} onClick={() => setTab('members')} icon={<Users size={14} />} label="成员" badge={info.memberCount} />
      </div>

      {/* ── 聊天（生日祝福从日历点过来会预填） ── */}
      {tab === 'chat' && (
        <ClassChat
          classId={classId}
          myAlias={info.myAlias}
          myAvatar={siteMe?.avatarUrl || ''}
          avatarByAlias={Object.fromEntries(
            (info.members || [])
              .map((m: any) => [m.alias, (m as any).avatarUrl || (m as any).avatar_url || ''])
              .filter(([, u]: any) => !!u),
          )}
          pendingWish={pendingWish}
          onWishSent={() => setPendingWish(null)}
        />
      )}

      {/* ── 总览（v1.2.9 R6：统计不单独开页，放总览） ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<Megaphone size={14} />} label="公告" value={anns.length} sub={unread > 0 ? `${unread} 条未读` : '全部已读'} onClick={() => setTab('announcements')} />
            <StatCard icon={<ListChecks size={14} />} label="接龙" value={chains.length} sub={`${openChains} 个进行中`} onClick={() => setTab('chains')} />
            <StatCard icon={<Vote size={14} />} label="投票" value={polls.length} sub={`${openPolls} 个进行中`} onClick={() => setTab('polls')} />
            <StatCard icon={<Users size={14} />} label="成员" value={info.memberCount} sub={`上限 ${info.maxMembers}`} onClick={() => setTab('members')} />
          </div>

          {/* 星露谷风格：生日日历 + 村务告示板 */}
          <BirthdayBoard
            members={(info.members || []).map((m: any) => ({ alias: m.alias, birthday: m.birthday }))}
            onSendWish={(to, text) => {
              setPendingWish({ to, text });
              setTab('chat');
              toast.info(`已为 ${to} 准备好祝福语，在聊天里发送吧 🎂`);
            }}
            announcements={anns.map((a: any) => ({
              id: a.id, title: a.title, body: a.body,
              createdAt: a.createdAt ?? a.created_at,
              authorAlias: a.authorAlias ?? a.author_alias,
            }))}
            onOpenAnnouncement={() => setTab('announcements')}
          />

          <div className="glass-panel p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="label-tag">班级信息</span>
              <CopyInvite code={info.inviteCode} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-secondary font-mono text-xs">
              <span>班级码：<span className="text-neon-green">{info.classCode}</span></span>
              <span>我的角色：<span className={isOwner ? 'text-neon-yellow' : isAdmin ? 'text-neon-cyan' : ''}>{info.role}</span></span>
              <span>创建者：<span className="text-text-primary">{info.ownerAlias}</span></span>
              <span>最近同步：{info.lastSyncedAt ? fmt(info.lastSyncedAt) : '从未'}</span>
            </div>
          </div>

        </div>
      )}

      {/* ── 公告 ── */}
      {tab === 'announcements' && (
        <div className="space-y-2">
          {loading ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">加载中…</div>
          ) : anns.length === 0 ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">还没有公告</div>
          ) : anns.map((a: any) => (
            <div
              key={a.id}
              className={`glass-panel p-4 group ${a.isRead ? 'opacity-70' : 'border-neon-green/40'}`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {a.isRead
                    ? <Circle size={12} className="text-text-dim shrink-0 cursor-pointer" onClick={() => markRead(a.id)} />
                    : <CheckCircle2 size={12} className="text-neon-green shrink-0 cursor-pointer" onClick={() => markRead(a.id)} />}
                  <span className={`font-bold truncate ${a.isRead ? 'text-text-primary' : 'text-neon-green'}`}>{a.title}</span>
                  {a.pinned && <span className="text-[10px] text-neon-yellow shrink-0">📌 置顶</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-text-dim font-mono text-[10px]">{fmt(a.createdAt)}</span>
                  {canManage && (
                    <button
                      onClick={() => deleteAnn(a.id)}
                      className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-text-dim hover:text-red-400 transition-opacity"
                      title="删除公告"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-text-secondary text-sm whitespace-pre-wrap ml-5">{a.body}</div>
              {a.authorAlias && <div className="text-text-dim font-mono text-[10px] mt-1 ml-5">—— {a.authorAlias}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ── 接龙 ── */}
      {tab === 'chains' && (
        <ChainList classId={classId} chains={chains} myAlias={info.myAlias} canManage={canManage} onChanged={refresh} />
      )}

      {/* ── 投票 ── */}
      {tab === 'polls' && (
        <PollList classId={classId} polls={polls} myAlias={info.myAlias} canManage={canManage} onChanged={refresh} />
      )}

      {/* ── 成员 ── */}
      {tab === 'members' && (
        <MemberList classId={classId} info={info} onChanged={refresh} myAvatar={siteMe?.avatarUrl || ''} />
      )}

      {/* owner：班级设置 */}
      {showClassSettings && info && (
        <ClassSettingsModal
          classId={classId}
          info={info}
          onClose={() => setShowClassSettings(false)}
          onSaved={() => { setShowClassSettings(false); refresh(); }}
        />
      )}

      {/* 发布 modal */}
      {showPublishAnn && (
        <PublishAnnouncementModal classId={classId} onClose={() => setShowAnn(false)} onPublished={() => { setShowAnn(false); refresh(); }} />
      )}
      {showCreateChain && (
        <CreateChainModal classId={classId} onClose={() => setShowChain(false)} onCreated={() => { setShowChain(false); refresh(); }} />
      )}
      {showCreatePoll && (
        <CreatePollModal classId={classId} onClose={() => setShowPoll(false)} onCreated={() => { setShowPoll(false); refresh(); }} />
      )}
    </div>
  );
}

// ============================================================
// 总览小组件
// ============================================================

function StatCard({ icon, label, value, sub, onClick }: any) {
  return (
    <div onClick={onClick} className="glass-panel p-4 cursor-pointer hover:border-neon-green/40 transition-all">
      <div className="flex items-center gap-2 text-text-dim font-mono text-[11px] mb-1">
        <span className="text-neon-green">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold text-neon-green font-mono">{value}</div>
      <div className="text-text-dim font-mono text-[10px] mt-0.5">{sub}</div>
    </div>
  );
}

function CopyInvite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          toast.success('邀请码已复制');
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex items-center gap-1 text-text-dim hover:text-neon-green font-mono text-[11px]"
    >
      {copied ? <CheckCircle2 size={12} className="text-neon-green" /> : <Copy size={12} />}
      {copied ? '已复制' : code}
    </button>
  );
}

// ============================================================
// 接龙列表
// ============================================================

function ChainList({ classId, chains, myAlias, canManage, onChanged }: any) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (chainId: number) => {
    const c = String(input).trim();
    if (!c) { toast.warn('请输入接龙内容'); return; }
    setBusy(true);
    try {
      const r = await window.taskAPI.class.joinChain(classId, chainId, c);
      if (r.ok) { setInput(''); toast.success('已参与接龙'); onChanged(); }
      else toast.error(r.error || '参与失败');
      if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000);
    } catch (e: any) { toast.error(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const close = async (chainId: number) => {
    if (!window.confirm('结束后成员不能再接龙，确定？')) return;
    try {
      const r = await window.taskAPI.class.closeChain(classId, chainId);
      if (r.ok) { toast.success('接龙已结束'); onChanged(); }
      else toast.error(r.error || '操作失败');
    } catch (e: any) { toast.error(e?.message || String(e)); }
  };

  if (chains.length === 0) {
    return <div className="text-text-dim font-mono text-xs text-center py-4">还没有接龙（点右上「+ 接龙」发起）</div>;
  }

  return (
    <div className="space-y-2">
      {chains.map((c: any) => {
        const open = expanded === c.id;
        const mine = c.authorAlias === myAlias;
        const canClose = (canManage || mine) && !c.closed;
        const items = c.items || [];
        const joined = items.some((it: any) => it.alias === myAlias);
        const copyList = async () => {
          const text = [`${c.title}（${items.length} 人）`, ...items.map((it: any, i: number) => `${i + 1}. ${it.alias} — ${it.content}`)].join('\n');
          try { await navigator.clipboard.writeText(text); toast.success('名单已复制'); }
          catch { toast.warn('复制失败，请手动选择'); }
        };
        return (
          <div key={c.id} className="glass-panel p-4">
            <div
              className="flex items-start justify-between cursor-pointer"
              onClick={() => setExpanded(open ? null : c.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ListChecks size={14} className={c.closed ? 'text-text-dim shrink-0' : 'text-neon-green shrink-0'} />
                <span className={`font-bold truncate ${c.closed ? 'text-text-secondary' : 'text-text-primary'}`}>{c.title}</span>
                {c.closed && <span className="text-[10px] text-text-dim shrink-0 flex items-center gap-0.5"><Lock size={9} />已结束</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-text-dim font-mono text-[10px]">{items.length} 人接龙</span>
                {joined && !c.closed && (
                  <span className="text-[10px] font-mono text-neon-green border border-neon-green/40 rounded px-1">已接龙</span>
                )}
                {items.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); copyList(); }}
                    className="text-text-dim hover:text-neon-green font-mono text-[10px]"
                    title="复制完整名单"
                  >
                    复制名单
                  </button>
                )}
                {canClose && (
                  <button
                    onClick={(e) => { e.stopPropagation(); close(c.id); }}
                    className="text-text-dim hover:text-neon-yellow font-mono text-[10px]"
                  >
                    结束
                  </button>
                )}
              </div>
            </div>

            {open && (
              <div className="mt-3 border-t border-neon-green/10 pt-3">
                {c.body && <div className="text-text-dim font-mono text-[11px] mb-2">{c.body}</div>}
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {(c.items || []).map((it: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-text-dim w-6 shrink-0">#{i + 1}</span>
                      <span className="text-neon-cyan shrink-0">{it.alias}</span>
                      <span className="text-text-secondary truncate">{it.content}</span>
                      <span className="text-text-dim text-[10px] ml-auto shrink-0">{fmtDate(it.ts, 'datetime').slice(5)}</span>
                    </div>
                  ))}
                  {(c.items || []).length === 0 && (
                    <div className="text-text-dim font-mono text-xs text-center py-2">还没有人接龙，来第一个</div>
                  )}
                </div>
                {!c.closed && !joined && (
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await window.taskAPI.class.joinChain(classId, c.id, '参加');
                        if (r.ok) { toast.success('已接龙'); onChanged(); }
                        else toast.error(r.error || '参与失败');
                      } catch (e: any) { toast.error(e?.message || String(e)); }
                      finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className="btn-neon text-xs py-1 mt-2 w-full"
                  >
                    <Plus size={12} /> 一键接龙（我参加）
                  </button>
                )}
                {!c.closed && (
                  <div className="flex gap-2 mt-3">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') join(c.id); }}
                      placeholder="接龙内容（如：张三 +1）"
                      className="input-neon flex-1 text-xs"
                      maxLength={200}
                    />
                    <button onClick={() => join(c.id)} disabled={busy} className="btn-neon text-xs px-3">
                      接龙
                    </button>
                  </div>
                )}
                <div className="text-text-dim font-mono text-[10px] mt-2">发起人：{c.authorAlias}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 投票列表
// ============================================================

function PollList({ classId, polls, myAlias, canManage, onChanged }: any) {
  const [busy, setBusy] = useState(false);

  const vote = async (pollId: number, choices: number[]) => {
    setBusy(true);
    try {
      const r = await window.taskAPI.class.votePoll(classId, pollId, choices);
      if (r.ok) { toast.success('投票成功（再次点击可改票）'); onChanged(); }
      else toast.error(r.error || '投票失败');
      if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000);
    } catch (e: any) { toast.error(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const close = async (pollId: number) => {
    if (!window.confirm('结束后不能再投票，确定？')) return;
    try {
      const r = await window.taskAPI.class.closePoll(classId, pollId);
      if (r.ok) { toast.success('投票已结束'); onChanged(); }
      else toast.error(r.error || '操作失败');
    } catch (e: any) { toast.error(e?.message || String(e)); }
  };

  if (polls.length === 0) {
    return <div className="text-text-dim font-mono text-xs text-center py-4">还没有投票（点右上「+ 投票」发起）</div>;
  }

  return (
    <div className="space-y-2">
      {polls.map((p: any) => {
        const votes = p.votes || {};
        const voters = Object.keys(votes);
        const myVote = votes[myAlias];
        const totalVoters = voters.length;
        const expired = p.deadlineAt && Date.now() > p.deadlineAt;
        const ended = p.closed || expired;
        const canClose = (canManage || p.authorAlias === myAlias) && !p.closed && !expired;

        // 每个选项的票数
        const counts = (p.options || []).map((_: any, i: number) =>
          voters.filter((a) => (votes[a]?.choices || []).includes(i)).length,
        );
        const maxCount = Math.max(1, ...counts);

        return (
          <div key={p.id} className="glass-panel p-4">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Vote size={14} className={ended ? 'text-text-dim shrink-0' : 'text-neon-green shrink-0'} />
                <span className={`font-bold truncate ${ended ? 'text-text-secondary' : 'text-text-primary'}`}>{p.question}</span>
                {p.multi && <span className="text-[10px] text-neon-cyan shrink-0">多选</span>}
                {ended && <span className="text-[10px] text-text-dim shrink-0 flex items-center gap-0.5"><Lock size={9} />{p.closed ? '已结束' : '已截止'}</span>}
                {!ended && !myVote && (
                  <span className="text-[10px] font-mono text-neon-yellow border border-neon-yellow/40 rounded px-1 shrink-0 animate-pulse-glow">待你投票</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-text-dim font-mono text-[10px]">{totalVoters} 人已投</span>
                {canClose && (
                  <button
                    onClick={() => close(p.id)}
                    className="text-text-dim hover:text-neon-yellow font-mono text-[10px]"
                  >
                    结束
                  </button>
                )}
              </div>
            </div>

            {p.description && <div className="text-text-dim font-mono text-[11px] mb-2 ml-6">{p.description}</div>}
            {(p.deadlineAt ?? p.deadline_at) && !p.closed && (
              <div className="text-text-dim font-mono text-[10px] mb-2 ml-6 flex items-center gap-1">
                <Clock size={10} /> 截止 {fmtDate(p.deadlineAt ?? p.deadline_at, 'datetime')}
                {(() => {
                  const ms = Number(p.deadlineAt ?? p.deadline_at) - Date.now();
                  if (ms <= 0) return null;
                  const h = Math.floor(ms / 3600000);
                  return <span className="text-neon-yellow">（还剩 {h >= 24 ? `${Math.floor(h / 24)} 天` : `${h} 小时`}）</span>;
                })()}
              </div>
            )}

            <div className="space-y-1.5 ml-6">
              {(p.options || []).map((o: any, i: number) => {
                const mine = (myVote?.choices || []).includes(i);
                const pct = totalVoters > 0 ? Math.round((counts[i] / totalVoters) * 100) : 0;
                return (
                  <div
                    key={i}
                    onClick={() => !ended && !busy && vote(p.id, p.multi ? toggleChoice(myVote?.choices || [], i) : [i])}
                    className={`relative rounded border px-3 py-1.5 text-xs transition-all overflow-hidden ${
                      ended ? 'cursor-default border-neon-green/10'
                        : mine ? 'cursor-pointer border-neon-green/60 bg-neon-green/5'
                        : 'cursor-pointer border-neon-green/15 hover:border-neon-green/40'
                    }`}
                  >
                    {/* 票数比例条 */}
                    <div
                      className="absolute inset-y-0 left-0 bg-neon-green/10 transition-all duration-500"
                      style={{ width: `${(counts[i] / maxCount) * 100}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className={mine ? 'text-neon-green font-bold' : 'text-text-secondary'}>
                        {mine && '✓ '}{o.text}
                      </span>
                      <span className="text-text-dim font-mono text-[10px]">{counts[i]} 票 · {pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {!ended && (
              <div className="text-text-dim font-mono text-[10px] mt-2 ml-6">
                {myVote ? '已投票（点击其他选项可改票' + (p.multi ? '，多选可切换）' : '）') : '点击选项投票'}
              </div>
            )}
            <div className="text-text-dim font-mono text-[10px] mt-1 ml-6">发起人：{p.authorAlias}</div>
          </div>
        );
      })}
    </div>
  );
}

function toggleChoice(cur: number[], i: number): number[] {
  return cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
}

// ============================================================
// 成员列表（v1.2.9 R3：角色管理 + 移除）
// ============================================================

function MemberList({ classId, info, onChanged, myAvatar = '' }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const isOwner = info.role === 'owner';
  const isAdmin = info.role === 'admin';

  // 改昵称 / 设生日 —— 弹编辑窗（旧版连环 window.prompt 一取消就中断，生日根本填不到）
  const [editing, setEditing] = useState<any | null>(null);
  /** 权限编辑目标（owner 专用） */
  const [permTarget, setPermTarget] = useState<any | null>(null);

  const promote = async (alias: string, role: 'admin' | 'member') => {
    setBusy(alias);
    try {
      const r = await window.taskAPI.class.promoteMember(classId, { alias, role });
      if (r.ok) { toast.success(role === 'admin' ? `${alias} 已设为管理员` : `已撤销 ${alias} 的管理员`); onChanged(); }
      else toast.error(r.error || '操作失败');
      if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000);
    } catch (e: any) { toast.error(e?.message || String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (alias: string) => {
    if (!window.confirm(`确定移除 ${alias}？对方将无法再看到该班级。`)) return;
    setBusy(alias);
    try {
      const r = await window.taskAPI.class.removeMember(classId, { alias });
      if (r.ok) { toast.success(`已移除 ${alias}`); onChanged(); }
      else toast.error(r.error || '操作失败');
      if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000);
    } catch (e: any) { toast.error(e?.message || String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="glass-panel p-4 space-y-1">
      {(info.members || []).map((m: any, i: number) => {
        const Icon = m.role === 'owner' ? Crown : m.role === 'admin' ? Shield : UserIcon;
        const color = m.role === 'owner' ? 'text-neon-yellow' : m.role === 'admin' ? 'text-neon-cyan' : 'text-text-secondary';
        const isMe = m.alias === info.myAlias;
        const canPromote = isOwner && m.role === 'member';
        const canDemote = isOwner && m.role === 'admin';
        const canRemove = (isOwner || isAdmin) && m.role !== 'owner' && (isOwner || m.role === 'member');
        return (
          <div key={i} className="flex items-center gap-3 py-1.5 border-b border-neon-green/5 last:border-b-0 group">
            <Avatar
              name={m.alias}
              url={absUrl((m as any).avatarUrl || (m as any).avatar_url || (m.alias === info.myAlias ? myAvatar : ''))}
              size={26}
            />
            <Icon size={12} className={`${color} shrink-0`} />
            <span className={`font-mono text-sm ${color} truncate`}>
              {m.alias}{isMe && <span className="text-text-dim text-[10px] ml-1">(我)</span>}
            </span>
            <span className="text-text-dim font-mono text-[11px] shrink-0">{m.role}</span>
            {m.birthday && <span className="text-neon-yellow font-mono text-[10px] shrink-0">🎂 {m.birthday}</span>}
            <span className="text-text-dim font-mono text-[10px] ml-auto shrink-0 hidden sm:inline">
              加入于 {fmtDate((m as any).joinedAt ?? (m as any).joined_at)}
            </span>
            {/* 改昵称/生日：自己永远可改；owner 可改任何人 */}
            <button
              onClick={() => setEditing(m)}
              disabled={busy === m.alias}
              className="text-text-dim hover:text-neon-green font-mono text-[10px] px-1.5 py-0.5 border border-neon-green/20 rounded shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
              title="改昵称 / 设生日"
            >
              <Pencil size={10} className="inline mr-0.5" />编辑
            </button>
            {/* 权限入口：owner 可给任何非 owner 成员调角色，并说明该角色能做什么 */}
            {isOwner && m.role !== 'owner' && (
              <button
                onClick={() => setPermTarget(m)}
                disabled={busy === m.alias}
                className="text-text-dim hover:text-neon-cyan font-mono text-[10px] px-1.5 py-0.5 border border-neon-cyan/30 rounded shrink-0"
                title="编辑该成员的权限"
              >
                <Shield size={10} className="inline mr-0.5" />权限
              </button>
            )}
            {/* v1.2.18：移动端没有 hover，这个模式会让「设管理员/移除成员」在手机上
                永远不可见不可点 —— 触屏上常显，桌面保留悬停显隐 */}
            {(canPromote || canDemote || canRemove) && (
              <div className="flex gap-1 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                {canPromote && (
                  <button
                    onClick={() => promote(m.alias, 'admin')}
                    disabled={busy === m.alias}
                    className="text-text-dim hover:text-neon-cyan font-mono text-[10px] px-1.5 py-0.5 border border-neon-cyan/20 rounded"
                    title="设为管理员"
                  >
                    <Shield size={10} className="inline mr-0.5" />设管理
                  </button>
                )}
                {canDemote && (
                  <button
                    onClick={() => promote(m.alias, 'member')}
                    disabled={busy === m.alias}
                    className="text-text-dim hover:text-neon-yellow font-mono text-[10px] px-1.5 py-0.5 border border-neon-yellow/20 rounded"
                    title="撤销管理员"
                  >
                    撤管理
                  </button>
                )}
                {canRemove && (
                  <button
                    onClick={() => remove(m.alias)}
                    disabled={busy === m.alias}
                    className="text-text-dim hover:text-red-400 font-mono text-[10px] px-1.5 py-0.5 border border-red-400/20 rounded"
                    title="移除成员"
                  >
                    <Trash2 size={10} className="inline mr-0.5" />移除
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!isOwner && !isAdmin && (
        <div className="text-text-dim font-mono text-[10px] pt-2">成员管理仅 owner / admin 可用</div>
      )}
      {permTarget && (
        <MemberPermModal
          member={permTarget}
          onClose={() => setPermTarget(null)}
          onSetRole={async (role) => { await promote(permTarget.alias, role); setPermTarget(null); }}
        />
      )}
      {editing && (
        <MemberEditModal
          member={editing}
          classId={classId}
          isSelf={editing.alias === info.myAlias}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 班级设置弹窗（owner：名称/简介/人数上限）
// ============================================================
function ClassSettingsModal({ classId, info, onClose, onSaved }: {
  classId: number; info: any; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(info.name || '');
  const [desc, setDesc] = useState(info.description || '');
  const [maxMembers, setMaxMembers] = useState(info.maxMembers ?? 50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('班级名称不能为空'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.updateSettings(classId, {
        name: name.trim(), description: desc.trim(), maxMembers: Number(maxMembers) || undefined,
      });
      if (r.ok) { toast.success('班级信息已更新'); onSaved(); }
      else setErr(r.error || '保存失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="班级设置" onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <div>
          <div className="label-tag mb-1">班级名称</div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-neon w-full" maxLength={60} autoFocus />
        </div>
        <div>
          <div className="label-tag mb-1">班级简介</div>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="input-neon w-full" rows={3} maxLength={300} />
        </div>
        <div>
          <div className="label-tag mb-1">人数上限</div>
          <input type="number" min={2} max={500} value={maxMembers}
            onChange={(e) => setMaxMembers(Number(e.target.value))} className="input-neon w-full" />
          <div className="text-[10px] text-text-dim font-mono mt-1">2–500；不能低于当前成员数</div>
        </div>
        {err && <div className="text-neon-danger font-mono text-xs">❌ {err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">取消</button>
          <button onClick={submit} disabled={busy} className="btn-neon px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// 成员资料编辑弹窗（昵称 + 生日）
// ============================================================
/**
 * 成员权限（owner 专用）：班级权限是**角色制**，服务端按 owner/admin/member 判定，
 * 所以这里把「某角色能做什么」摊开说明，再用一句话切换角色。
 */
function MemberPermModal({ member, onClose, onSetRole }: {
  member: any;
  onClose: () => void;
  onSetRole: (role: 'admin' | 'member') => Promise<void>;
}) {
  const isAdmin = member.role === 'admin';
  const [busy, setBusy] = useState(false);
  const caps: Array<[string, boolean]> = [
    ['发布公告 / 发布作业', isAdmin],
    ['管理成员（移除成员、调整角色）', isAdmin],
    ['发起接龙 / 发起投票', true],
    ['参与接龙、投票、完成作业、标记已读', true],
  ];
  return (
    <Modal title={`成员权限 · ${member.alias}`} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <div className="text-xs text-text-dim font-mono">
          当前角色：<span className={isAdmin ? 'text-neon-cyan' : 'text-text-secondary'}>{isAdmin ? '管理员 admin' : '成员 member'}</span>
        </div>
        <div className="space-y-1.5">
          {caps.map(([label, ok]) => (
            <div key={label} className="flex items-center gap-2 text-xs font-mono">
              <span className={ok ? 'text-neon-green' : 'text-text-dim'}>{ok ? '✓' : '✕'}</span>
              <span className={ok ? 'text-text-primary' : 'text-text-dim'}>{label}</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-text-dim font-mono leading-relaxed">
          管理员能发公告/作业、移除成员、关闭接龙与投票；普通成员仍可发起接龙和投票。
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">取消</button>
          {isAdmin ? (
            <button
              onClick={async () => { setBusy(true); try { await onSetRole('member'); } finally { setBusy(false); } }}
              disabled={busy}
              className="btn-ghost px-3 py-1.5 text-xs text-neon-yellow border-neon-yellow/40"
            >
              撤销管理员
            </button>
          ) : (
            <button
              onClick={async () => { setBusy(true); try { await onSetRole('admin'); } finally { setBusy(false); } }}
              disabled={busy}
              className="btn-neon px-3 py-1.5 text-xs"
            >
              设为管理员
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MemberEditModal({ member, classId, isSelf, onClose, onSaved }: {
  member: any; classId: number; isSelf: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [alias, setAlias] = useState(member.alias || '');
  const [bday, setBday] = useState(member.birthday || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (bday && !/^\d{2}-\d{2}$/.test(bday.trim())) {
      setErr('生日格式应为 MM-DD（如 05-20）');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.updateProfile(classId, {
        alias: alias.trim() || undefined,
        birthday: bday.trim(),
        ...(isSelf ? {} : { targetAlias: member.alias }),
      });
      if (r.ok) { toast.success('已保存'); onSaved(); }
      else setErr(r.error || '保存失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`编辑资料${isSelf ? '' : ` · ${member.alias}`}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <div>
          <div className="label-tag mb-1">昵称</div>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} className="input-neon w-full" placeholder="班级内显示的名字" autoFocus />
        </div>
        <div>
          <div className="label-tag mb-1">生日</div>
          <input value={bday} onChange={(e) => setBday(e.target.value)} className="input-neon w-full" placeholder="MM-DD，如 05-20（留空 = 不设置）" />
          <div className="text-[10px] text-text-dim font-mono mt-1">设置后会出现在班级生日日历里，生日当天同学们可以送祝福</div>
        </div>
        {err && <div className="text-neon-danger font-mono text-xs">❌ {err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">取消</button>
          <button onClick={submit} disabled={busy} className="btn-neon px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Tab 按钮
// ============================================================

function TabButton({ active, onClick, icon, label, badge }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-mono text-xs flex items-center gap-2 border-b-2 transition-colors ${
        active ? 'border-neon-green text-neon-green' : 'border-transparent text-text-dim hover:text-text-secondary'
      }`}
    >
      {icon} {label}
      {badge > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-neon-green/20' : 'bg-neon-green/10'}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================
// 发布公告（v1.2.9：不变，仅 UI 微调）
// ============================================================

function PublishAnnouncementModal({ classId, onClose, onPublished }: any) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setErr('请输入标题'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.publishAnnouncement(classId, { title: title.trim(), body: body.trim() });
      if (r.ok) {
        // v1.2.9 R9：警告必须让用户看见（之前 setWarnings 后立刻关弹窗 = 静默吞掉）
        if (r.warnings?.length) toast.warn(r.warnings.join('；'), 8000);
        onPublished();
      }
      else setErr(r.error || '发布失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="发布公告" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '发布中…' : '发布'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" autoFocus maxLength={80} />
        </div>
        <div>
          <span className="label-tag block mb-1">正文</span>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            className="input-neon min-h-[160px] resize-y"
            maxLength={4000}
          />
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
      </div>
    </Modal>
  );
}

// ============================================================
// 发起接龙（v1.2.9 R4）
// ============================================================

function CreateChainModal({ classId, onClose, onCreated }: any) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setErr('请输入接龙标题'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.createChain(classId, { title: title.trim(), body: body.trim() });
      if (r.ok) { if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000); onCreated(); }
      else setErr(r.error || '发起失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="发起接龙" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '发布中…' : '发起'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" autoFocus maxLength={80} placeholder="如：周六团建报名" />
        </div>
        <div>
          <span className="label-tag block mb-1">接龙说明（可选）</span>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            className="input-neon min-h-[100px] resize-y"
            maxLength={2000}
            placeholder="如：格式 姓名+电话，截止周五晚 8 点"
          />
        </div>
        <div className="text-text-dim font-mono text-[10px]">所有成员都能看到并参与接龙</div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
      </div>
    </Modal>
  );
}

// ============================================================
// 发起投票（v1.2.9 R5）
// ============================================================

function CreatePollModal({ classId, onClose, onCreated }: any) {
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setOption = (i: number, v: string) => {
    const next = [...options];
    next[i] = v;
    setOptions(next);
  };

  const submit = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) { setErr('请输入投票问题'); return; }
    if (opts.length < 2) { setErr('至少需要 2 个非空选项'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.createPoll(classId, {
        question: question.trim(),
        description: description.trim(),
        options: opts,
        multi,
        deadlineAt: deadline ? new Date(deadline).getTime() : undefined,
      });
      if (r.ok) { if (r.warnings?.length) toast.warn(r.warnings.join('；'), 5000); onCreated(); }
      else setErr(r.error || '发起失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="发起投票" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '发布中…' : '发起'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">投票问题 *</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} className="input-neon" autoFocus maxLength={120} placeholder="如：周三班会选哪个时间？" />
        </div>
        <div>
          <span className="label-tag block mb-1">补充说明（可选）</span>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            className="input-neon min-h-[60px] resize-y"
            maxLength={2000}
          />
        </div>
        <div>
          <span className="label-tag block mb-1">选项（2~8 个）*</span>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-text-dim font-mono text-xs w-4 shrink-0">{i + 1}.</span>
                <input
                  value={o}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="input-neon flex-1 text-xs"
                  maxLength={60}
                  placeholder={`选项 ${i + 1}`}
                />
                {options.length > 2 && (
                  <button
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    className="text-text-dim hover:text-red-400 shrink-0"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {options.length < 8 && (
              <button onClick={() => setOptions([...options, ''])} className="btn-ghost text-[10px] px-2 py-1">
                <Plus size={10} className="inline mr-0.5" />加一个选项
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-neon-green" />
            多选
          </label>
          <div className="flex items-center gap-2">
            <span className="label-tag text-xs">截止（可选）</span>
            <input
              type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="input-neon font-mono text-xs"
            />
          </div>
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
      </div>
    </Modal>
  );
}
