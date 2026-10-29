export interface GameRecordInput {
  userId: number;
  amount: number;
}

// PostgreSQL INTEGER 列上限：超出后数据库写入会报 22003（integer out of range）
const MAX_AMOUNT = 2147483647;

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
