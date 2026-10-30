import { describe, expect, it } from 'vitest';
import {
  buildGameShareText,
  buildLeaderboardShareText,
  formatDateTime,
  formatShareExpiryDate,
  formatSignedAmount,
  getAmountColorClass,
  getAvatarTheme,
  shareExpiryEndDay,
  shanghaiInputToIso,
  toDatetimeLocalValue,
} from './format';

describe('formatSignedAmount', () => {
  it('正数带 + 号，负数原样，零不带符号', () => {
    expect(formatSignedAmount(100)).toBe('+100');
    expect(formatSignedAmount(-50)).toBe('-50');
    expect(formatSignedAmount(0)).toBe('0');
  });
});

describe('getAmountColorClass', () => {
  it('红=赢、绿=输、灰=平', () => {
    expect(getAmountColorClass(10)).toBe('text-red-600');
    expect(getAmountColorClass(-10)).toBe('text-emerald-600');
    expect(getAmountColorClass(0)).toBe('text-slate-500');
  });
});

describe('getAvatarTheme', () => {
  it('按 colorId 匹配主题', () => {
    expect(getAvatarTheme('emerald').label).toBe('翡翠绿');
  });

  it('未知或缺失 colorId 回退到默认主题', () => {
    expect(getAvatarTheme('unknown').id).toBe('red');
    expect(getAvatarTheme().id).toBe('red');
  });
});

describe('时间格式化（Asia/Shanghai）', () => {
  it('formatDateTime 按上海时区换算（UTC 16:00 → 次日 00:00 跨日边界）', () => {
    expect(formatDateTime('2026-01-01T16:00:00Z')).toBe('2026/01/02 00:00');
  });

  it('无效 ISO 原样返回', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('toDatetimeLocalValue 固定加 8 小时偏移并截断到分钟', () => {
    expect(toDatetimeLocalValue(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02T00:00');
  });

  it('shanghaiInputToIso 把上海墙上时间转回 UTC', () => {
    expect(shanghaiInputToIso('2026-01-02T00:00')).toBe('2026-01-01T16:00:00.000Z');
    expect(shanghaiInputToIso('2026-01-02T00:00:00')).toBe('2026-01-01T16:00:00.000Z');
  });

  it('shanghaiInputToIso 对空值/非法值返回 null', () => {
    expect(shanghaiInputToIso('')).toBeNull();
    expect(shanghaiInputToIso('not-a-date')).toBeNull();
  });
});

describe('分享有效期展示（上海自然日）', () => {
  it('shareExpiryEndDay：自然日 24:00 边界（次日 00:00）取前一天为末日', () => {
    // 11-01 24:00 上海（= 11-01T16:00Z）→ 末日 11-01
    expect(shareExpiryEndDay('2026-11-01T16:00:00.000Z')).toBe('2026-11-01');
  });

  it('shareExpiryEndDay：兼容旧数据任意时刻过期，取过期时刻的上海自然日', () => {
    // 11-03 00:43 上海过期（旧公式）→ 末日 11-03
    expect(shareExpiryEndDay('2026-11-02T16:43:49.000Z')).toBe('2026-11-03');
  });

  it('shareExpiryEndDay：非法输入返回空串', () => {
    expect(shareExpiryEndDay('not-a-date')).toBe('');
  });

  it('formatShareExpiryDate 输出「X月X日」', () => {
    expect(formatShareExpiryDate('2026-11-01T16:00:00.000Z')).toBe('11月1日');
    expect(formatShareExpiryDate('2026-11-12T16:00:00.000Z')).toBe('11月12日');
    expect(formatShareExpiryDate('not-a-date')).toBeNull();
  });
});

describe('buildGameShareText', () => {
  const game = {
    id: 1,
    playedAt: '2026-01-01T16:00:00Z',
    roomFee: 50,
    note: '茶楼',
    records: [
      { nickname: '张三', amount: 200, isBigWinner: true },
      { nickname: '李四', amount: -150, isBigWinner: false },
      { nickname: '王五', amount: 0, isBigWinner: false },
      { nickname: '赵六', amount: 50, isBigWinner: false },
    ],
  };

  it('包含标题、时间、备注与大赢家行', () => {
    const text = buildGameShareText(game);

    expect(text).toContain('🏆 【大赢家·本场战报】');
    expect(text).toContain('📅 时间：2026/01/02 00:00 (茶楼)');
    expect(text).toContain('👑 本场大赢家：张三');
  });

  it('玩家行按输赢着色符号，房费恒为 +', () => {
    const text = buildGameShareText(game);

    // 大赢家恒用 👑，其余按红赢绿输平灰
    expect(text).toContain('👑 张三：+200');
    expect(text).toContain('🔴 赵六：+50');
    expect(text).toContain('🟢 李四：-150');
    expect(text).toContain('⚪ 王五：0');
    expect(text).toContain('🤖 本场房费：+50');
  });

  it('传入累计总房费时追加累计行', () => {
    const text = buildGameShareText(game, 1200);

    expect(text).toContain('💰 累计总房费：1200');
  });

  it('浏览器环境追加榜单链接', () => {
    const text = buildGameShareText(game);

    expect(text).toContain('👉 查看详细榜单：http://localhost:3000');
  });
});

describe('buildLeaderboardShareText', () => {
  const leaderboard = [
    { rank: 1, nickname: '张三', netAmount: 500, gamesPlayed: 3, bigWinnerCount: 2 },
    { rank: 2, nickname: '李四', netAmount: -100, gamesPlayed: 2, bigWinnerCount: 0 },
    { rank: 3, nickname: '王五', netAmount: 0, gamesPlayed: 0, bigWinnerCount: 0 },
  ];

  it('包含标题与总场次，不突出房费', () => {
    const text = buildLeaderboardShareText('10月', 5, leaderboard);

    expect(text).toContain('🏆 【大赢家·10月风云榜】');
    expect(text).toContain('共计 5 场');
    expect(text).not.toContain('房费');
  });

  it('榜首盈利者标注头号赢家，前三名用奖牌，附场次与 👑 次数', () => {
    const text = buildLeaderboardShareText('10月', 5, leaderboard);

    expect(text).toContain('🥇 张三：+500 [3场] (👑x2) 👑头号赢家');
    expect(text).toContain('🥈 李四：-100 [2场]');
  });

  it('榜首亏损时不标注头号赢家', () => {
    const losers = [
      { rank: 1, nickname: '李四', netAmount: -100, gamesPlayed: 2, bigWinnerCount: 0 },
    ];
    const text = buildLeaderboardShareText('10月', 2, losers);

    expect(text).not.toContain('头号赢家');
    expect(text).toContain('🥇 李四：-100 [2场]');
  });

  it('过滤 0 场玩家，第四名起用数字序号', () => {
    const withMore = [
      ...leaderboard,
      { rank: 4, nickname: '赵六', netAmount: -400, gamesPlayed: 4, bigWinnerCount: 0 },
      { rank: 5, nickname: '陈八', netAmount: 0, gamesPlayed: 1, bigWinnerCount: 0 },
    ];
    const text = buildLeaderboardShareText('10月', 9, withMore);

    expect(text).not.toContain('王五');
    expect(text).toContain('🥉 赵六：-400 [4场]');
    expect(text).toContain('4. 陈八：0 [1场]');
  });
});
