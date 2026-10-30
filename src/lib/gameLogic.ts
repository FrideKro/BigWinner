export interface GameRecordInput {
  userId: number;
  amount: number;
}

// PostgreSQL INTEGER 列上限：超出后数据库写入会报 22003（integer out of range）
const MAX_AMOUNT = 2147483647;
export const MAX_PLAYERS_PER_GAME = 50;

export function validateAndComputeRecords(
  rawRecords: unknown,
  rawRoomFee: unknown,
): {
  error?: string;
  roomFee: number;
  records: Array<{ userId: number; amount: number; isBigWinner: boolean }>;
} {
  const roomFee = Number(rawRoomFee);
  if (!Number.isInteger(roomFee) || roomFee < 0) {
    return {
      error: '本场房费必须为大于或等于 0 的整数',
      roomFee: 0,
      records: [],
    };
  }
  if (roomFee > MAX_AMOUNT) {
    return {
      error: `本场房费超出系统上限（不超过 ${MAX_AMOUNT}）`,
      roomFee,
      records: [],
    };
  }

  if (!Array.isArray(rawRecords) || rawRecords.length < 2) {
    return {
      error: '每场至少需要选择 2 名参与玩家',
      roomFee,
      records: [],
    };
  }
  if (rawRecords.length > MAX_PLAYERS_PER_GAME) {
    return {
      error: `每场最多支持 ${MAX_PLAYERS_PER_GAME} 名参与玩家`,
      roomFee,
      records: [],
    };
  }

  const seenUsers = new Set<number>();
  const parsed: Array<{ userId: number; amount: number }> = [];

  for (const item of rawRecords) {
    const userId = Number((item as GameRecordInput)?.userId);
    const amount = Number((item as GameRecordInput)?.amount);

    if (!Number.isInteger(userId) || userId <= 0) {
      return { error: '存在无效的玩家 ID', roomFee, records: [] };
    }
    if (!Number.isInteger(amount)) {
      return {
        error: '所有玩家的输赢金额必须为整数',
        roomFee,
        records: [],
      };
    }
    if (Math.abs(amount) > MAX_AMOUNT) {
      return {
        error: `单笔输赢金额超出系统上限（绝对值不超过 ${MAX_AMOUNT}）`,
        roomFee,
        records: [],
      };
    }
    if (seenUsers.has(userId)) {
      return {
        error: '同一场次不能重复选择同一名玩家',
        roomFee,
        records: [],
      };
    }
    seenUsers.add(userId);
    parsed.push({ userId, amount });
  }

  const playerSum = parsed.reduce((acc, r) => acc + r.amount, 0);
  const totalBalance = playerSum + roomFee;

  if (totalBalance !== 0) {
    return {
      error: `账目未配平：玩家输赢合计 (${playerSum > 0 ? `+${playerSum}` : playerSum}) + 房费 (+${roomFee}) = ${totalBalance > 0 ? `+${totalBalance}` : totalBalance}，总和必须为 0`,
      roomFee,
      records: [],
    };
  }

  const maxAmount = Math.max(...parsed.map((r) => r.amount));
  const records = parsed.map((r) => ({
    userId: r.userId,
    amount: r.amount,
    isBigWinner: maxAmount > 0 && r.amount === maxAmount,
  }));

  return { roomFee, records };
}

// 当前上海时区的年（YYYY）与月（MM），供周期过滤与 stats 全局概览共用
export function currentShanghaiYearMonth(): { year: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return {
    year: parts.find((p) => p.type === 'year')?.value || '2026',
    month: parts.find((p) => p.type === 'month')?.value || '01',
  };
}

// 当前上海时区的自然日（YYYY-MM-DD），供分享有效期等自然日语义使用
export function currentShanghaiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

export function buildPeriodFilter(
  period: string,
  paramStartIndex: number,
): { clause: string; params: unknown[] } {
  const { year: currentYear, month: currentMonthPart } = currentShanghaiYearMonth();
  const currentMonth = `${currentYear}-${currentMonthPart}`;

  let year: number;
  let month: number | null = null;
  if (period === 'year' || /^\d{4}$/.test(period)) {
    year = parseInt(period === 'year' ? currentYear : period, 10);
  } else if (period === 'month' || /^(\d{4})-(0[1-9]|1[0-2])$/.test(period)) {
    const ym = period === 'month' ? currentMonth : period;
    year = parseInt(ym.slice(0, 4), 10);
    month = parseInt(ym.slice(5, 7), 10);
  } else {
    return { clause: '', params: [] };
  }

  // 上海时区固定 UTC+8（无夏令时）：把年/月换算成 UTC 边界后用范围条件过滤，
  // 避免 TO_CHAR 包裹列导致 played_at 索引失效；口径与原 TO_CHAR 写法完全等价
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const startMs =
    month === null
      ? Date.UTC(year, 0, 1) - SHANGHAI_OFFSET_MS
      : Date.UTC(year, month - 1, 1) - SHANGHAI_OFFSET_MS;
  const endMs =
    month === null
      ? Date.UTC(year + 1, 0, 1) - SHANGHAI_OFFSET_MS
      : Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS;

  return {
    clause: `AND g.played_at >= $${paramStartIndex} AND g.played_at < $${paramStartIndex + 1}`,
    params: [new Date(startMs), new Date(endMs)],
  };
}

// 自定义日期区间过滤（分享链接的起止日期，上海时区自然日，含 end 当天）：
// 换算成 UTC 边界后用范围条件过滤，口径与 buildPeriodFilter 一致（命中 idx_games_played_at_id）。
// 起止格式非法、日期不存在（如 2 月 30 日）或 end 早于 start 时返回 null，由调用方转 400
export function buildDateRangeFilter(
  start: string,
  end: string,
  paramStartIndex: number,
): { clause: string; params: unknown[] } | null {
  const matchStart = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const matchEnd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!matchStart || !matchEnd) return null;

  // Date.UTC 对越界的日/月会自动进位，用「分量重建后逐项比对」识别不存在的日期
  const [y1, m1, d1] = [Number(matchStart[1]), Number(matchStart[2]), Number(matchStart[3])];
  const [y2, m2, d2] = [Number(matchEnd[1]), Number(matchEnd[2]), Number(matchEnd[3])];
  const startDate = new Date(Date.UTC(y1, m1 - 1, d1));
  const endDate = new Date(Date.UTC(y2, m2 - 1, d2));
  if (
    startDate.getUTCFullYear() !== y1 ||
    startDate.getUTCMonth() !== m1 - 1 ||
    startDate.getUTCDate() !== d1 ||
    endDate.getUTCFullYear() !== y2 ||
    endDate.getUTCMonth() !== m2 - 1 ||
    endDate.getUTCDate() !== d2 ||
    endDate < startDate
  ) {
    return null;
  }

  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const startMs = startDate.getTime() - SHANGHAI_OFFSET_MS;
  // 结束边界 = 结束日次日 00:00（上海），保证包含 range_end 当天的全部对局
  const endMs = endDate.getTime() + 24 * 60 * 60 * 1000 - SHANGHAI_OFFSET_MS;

  return {
    clause: `AND g.played_at >= $${paramStartIndex} AND g.played_at < $${paramStartIndex + 1}`,
    params: [new Date(startMs), new Date(endMs)],
  };
}
