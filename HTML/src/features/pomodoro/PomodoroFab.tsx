/**
 * v1.2.8 块 P：番茄钟浮动按钮（48px，可拖动）
 * - 使用通用 useDragPosition hook（边界 clamp + 3px 阈值 + 持久化）
 * - 双击重置位置
 * - 单击切换 open
 * - phase !== idle 时显示 mm:ss + pulse-glow
 */
import { MutableRefObject } from 'react';
import { Timer, X } from 'lucide-react';
import clsx from '../../utils/clsx';
import type { Phase } from './types';

interface PomodoroFabProps {
  pos: { x: number; y: number };
  dragging: boolean;
  didDragRef: MutableRefObject<boolean>;
  startDrag: (e: React.MouseEvent) => void;
  onClick: () => void;
  onDoubleClick: () => void;
  /** 右键 = 关闭番茄钟（习惯页可重新打开） */
  onContextMenu?: (e: React.MouseEvent) => void;
  phase: Phase;
  paused: boolean;
  mm: string;
  ss: string;
  open: boolean;
  flash: boolean;
}

export function PomodoroFab({
  pos, dragging, startDrag, onClick, onDoubleClick, onContextMenu,
  phase, paused, mm, ss, open, flash,
}: PomodoroFabProps) {
  const iconColor =
    phase === 'work' ? 'text-neon-green' :
    phase === 'break' ? 'text-neon-yellow' :
    'text-text-secondary';

  return (
    <button
      onMouseDown={startDrag}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title="左键：开始/暂停 · 双击：重置位置 · 右键：关闭番茄钟"
      className={clsx(
        'w-12 h-12 rounded-full glass-panel flex items-center justify-center ease-spring',
        'shadow-neon-green hover:shadow-[0_0_18px_rgba(0,255,136,0.5)]',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        phase !== 'idle' && !open && 'animate-pulse-glow',
        flash && 'ring-2 ring-neon-green',
      )}
      aria-label={open ? '关闭番茄钟面板' : '打开番茄钟面板'}
    >
      {open ? (
        <X size={18} className="text-text-secondary" />
      ) : (
        <div className="flex flex-col items-center leading-none">
          <Timer size={16} className={iconColor} />
          {phase !== 'idle' && (
            <span className={clsx('font-mono text-[9px] font-bold mt-0.5 tabular-nums', paused && 'opacity-60')}>
              {mm}:{ss}
            </span>
          )}
        </div>
      )}
    </button>
  );
}