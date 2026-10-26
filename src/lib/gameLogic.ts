export interface GameRecordInput {
  userId: number;
  amount: number;
}

export function validateAndComputeRecords(
  rawRecords: unknown,
  rawRoomFee: unknown
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

export function buildPeriodFilter(
  period: string,
  paramStartIndex: number
): { clause: string; params: unknown[] } {
  const now = new Date();
  const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = shanghaiFormatter.formatToParts(now);
  const currentYear = parts.find((p) => p.type === 'year')?.value || '2026';
  const currentMonth = `${currentYear}-${parts.find((p) => p.type === 'month')?.value || '01'}`;

  if (!period || period === 'all') {
    return { clause: '', params: [] };
  }
  if (period === 'year') {
    return {
      clause: `AND TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY') = $${paramStartIndex}`,
      params: [currentYear],
    };
  }
  if (period === 'month') {
    return {
      clause: `AND TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = $${paramStartIndex}`,
      params: [currentMonth],
    };
  }
  if (/^\d{4}$/.test(period)) {
    return {
      clause: `AND TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY') = $${paramStartIndex}`,
      params: [period],
    };
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return {
      clause: `AND TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = $${paramStartIndex}`,
      params: [period],
    };
  }
  return { clause: '', params: [] };
}
