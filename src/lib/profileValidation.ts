// 与 db.ts 中 users 表的 VARCHAR 长度保持一致；超长时数据库会报 22001 并变成 500
export const MAX_USERNAME_LENGTH = 64;
export const MAX_NICKNAME_LENGTH = 64;
export const MAX_AVATAR_COLOR_LENGTH = 32;

/** 校验账号 / 昵称 / 头像色长度，未传（undefined）的字段跳过；返回中文错误或 null */
export function validateProfileLengths(fields: {
  username?: string;
  nickname?: string;
  avatarColor?: string;
}): string | null {
  const { username, nickname, avatarColor } = fields;
  if (username !== undefined && username.length > MAX_USERNAME_LENGTH) {
    return `登录账号不能超过 ${MAX_USERNAME_LENGTH} 个字符`;
  }
  if (nickname !== undefined && nickname.length > MAX_NICKNAME_LENGTH) {
    return `昵称不能超过 ${MAX_NICKNAME_LENGTH} 个字符`;
  }
  if (avatarColor !== undefined && avatarColor.length > MAX_AVATAR_COLOR_LENGTH) {
    return '头像颜色无效';
  }
  return null;
}
