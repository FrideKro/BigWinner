export interface AvatarTheme {
  id: string;
  label: string;
  bg: string;
  text: string;
  ring: string;
}

export const AVATAR_THEMES: AvatarTheme[] = [
  {
    id: 'red',
    label: '朱砂红',
    bg: 'bg-gradient-to-br from-rose-500 to-red-700',
    text: 'text-white',
    ring: 'ring-rose-200',
  },
  {
    id: 'amber',
    label: '帝王金',
    bg: 'bg-gradient-to-br from-amber-400 to-yellow-600',
    text: 'text-slate-950',
    ring: 'ring-amber-200',
  },
  {
    id: 'emerald',
    label: '翡翠绿',
    bg: 'bg-gradient-to-br from-emerald-500 to-teal-700',
    text: 'text-white',
    ring: 'ring-emerald-200',
  },
  {
    id: 'blue',
    label: '景泰蓝',
    bg: 'bg-gradient-to-br from-blue-500 to-indigo-700',
    text: 'text-white',
    ring: 'ring-blue-200',
  },
  {
    id: 'purple',
    label: '紫气东来',
    bg: 'bg-gradient-to-br from-purple-500 to-violet-700',
    text: 'text-white',
    ring: 'ring-purple-200',
  },
  {
    id: 'slate',
    label: '玄铁黑',
    bg: 'bg-gradient-to-br from-slate-700 to-slate-900',
    text: 'text-amber-300',
    ring: 'ring-slate-300',
  },
];

export function getAvatarTheme(colorId?: string): AvatarTheme {
  return AVATAR_THEMES.find((t) => t.id === colorId) || AVATAR_THEMES[0];
}

export function formatSignedAmount(amount: number): string {
  if (amount > 0) return `+${amount}`;
  if (amount < 0) return `${amount}`;
  return '0';
}

export function getAmountColorClass(amount: number): string {
  if (amount > 0) return 'text-red-600';
  if (amount < 0) return 'text-emerald-600';
  return 'text-slate-500';
}

// Intl.DateTimeFormat 构造开销较大（实测 100 次约 16ms，复用后 0.2ms），
// 时区与 locale 固定，模块级复用即可
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTimeFormatter.format(date);
}

export function toDatetimeLocalValue(date: Date = new Date()): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  const shanghaiDate = new Date(date.getTime() + offsetMs);
  return shanghaiDate.toISOString().slice(0, 16);
}

// 把 datetime-local 控件里的上海墙上时间转成 UTC ISO，避免设备时区不同导致偏移
export function shanghaiInputToIso(value: string): string | null {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', 'true');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function buildGameShareText(
  game: {
    id: number;
    playedAt: string;
    roomFee: number;
    note: string;
    records: Array<{
      nickname: string;
      amount: number;
      isBigWinner: boolean;
    }>;
  },
  allTimeRoomFee?: number,
): string {
  const dateStr = formatDateTime(game.playedAt);
  const bigWinners = game.records
    .filter((r) => r.isBigWinner)
    .map((r) => r.nickname)
    .join('、');

  const lines: string[] = [
    `🏆 【大赢家·本场战报】`,
    `📅 时间：${dateStr}${game.note ? ` (${game.note})` : ''}`,
  ];

  if (bigWinners) {
    lines.push(`👑 本场大赢家：${bigWinners}`);
  }

  lines.push(`----------------`);
  for (const r of game.records) {
    const icon = r.isBigWinner ? '👑' : r.amount > 0 ? '🔴' : r.amount < 0 ? '🟢' : '⚪';
    lines.push(`${icon} ${r.nickname}：${formatSignedAmount(r.amount)}`);
  }
  lines.push(`🤖 本场房费：+${game.roomFee}`);

  if (typeof allTimeRoomFee === 'number') {
    lines.push(`💰 累计总房费：${allTimeRoomFee}`);
  }

  if (typeof window !== 'undefined') {
    lines.push(`----------------`);
    lines.push(`👉 查看详细榜单：${window.location.origin}`);
  }

  return lines.join('\n');
}

export function buildLeaderboardShareText(
  periodLabel: string,
  totalGames: number,
  leaderboard: Array<{
    rank: number;
    nickname: string;
    netAmount: number;
    gamesPlayed: number;
    bigWinnerCount: number;
  }>,
): string {
  const activeRows = leaderboard.filter((r) => r.gamesPlayed > 0);
  const lines: string[] = [
    `🏆 【大赢家·${periodLabel}风云榜】`,
    `📊 共计 ${totalGames} 场`,
    `----------------`,
  ];

  activeRows.forEach((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
    const bwTag = p.bigWinnerCount > 0 ? ` (👑x${p.bigWinnerCount})` : '';
    const topTag = idx === 0 && p.netAmount > 0 ? ' 👑头号赢家' : '';
    lines.push(
      `${medal} ${p.nickname}：${formatSignedAmount(p.netAmount)} [${p.gamesPlayed}场]${bwTag}${topTag}`,
    );
  });

  if (typeof window !== 'undefined') {
    lines.push(`----------------`);
    lines.push(`👉 微信点开查看完整战绩：${window.location.origin}`);
  }

  return lines.join('\n');
}
