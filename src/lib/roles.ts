// 角色定义与解析：users.role 的全部合法取值与中文展示名在此单点维护，
// API 层（users POST/PATCH）与前端管理台共用同一份白名单，防止口径漂移

export type UserRole = 'ADMIN' | 'PLAYER' | 'TEMP_PLAYER';

export const USER_ROLES: UserRole[] = ['ADMIN', 'PLAYER', 'TEMP_PLAYER'];

export const TEMP_PLAYER_ROLE: UserRole = 'TEMP_PLAYER';

/** 角色中文展示名（管理台徽章与角色选择按钮共用） */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: '管理员',
  PLAYER: '普通玩家',
  TEMP_PLAYER: '临时玩家',
};

/** 管理台列表徽章用的单字/短标签（不占宽度） */
export const ROLE_BADGE_LABELS: Record<UserRole, string> = {
  ADMIN: '官',
  PLAYER: '',
  TEMP_PLAYER: '临',
};

/** 任意输入 → 合法角色；非法或空值返回 null（API 层据此返回 400） */
export function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  return (USER_ROLES as string[]).includes(value) ? (value as UserRole) : null;
}
