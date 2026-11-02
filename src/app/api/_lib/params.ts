// 路由参数严格解析：仅接受纯数字字符串，拒绝 parseInt("12abc") → 12 的宽松行为，
// 避免非法 ID/分页参数被静默截断成另一个合法值。业务层解析（DB 数值字符串）不适用本工具。
/** 严格解析正整数（ID 等）：非法返回 null */
export function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 严格解析非负整数（offset 等，允许 0）：非法返回 null */
export function parseNonNegativeInt(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
