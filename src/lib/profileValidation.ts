// 与 db.ts 中 users 表的 VARCHAR 长度保持一致；超长时数据库会报 22001 并变成 500
export const MAX_USERNAME_LENGTH = 64;
export const MAX_NICKNAME_LENGTH = 64;
export const MAX_AVATAR_COLOR_LENGTH = 32;
export const MIN_PASSWORD_LENGTH = 4;
// 对齐 Bcrypt 72 字节截断上限，防止传入超大字符串造成 CPU DoS
export const MAX_PASSWORD_LENGTH = 72;
export const MAX_GAME_NOTE_LENGTH = 200;
// 头像图片 data URL 字符数上限（含前缀，约 24KB 原始数据）；前端已压缩到 128×128 JPEG
export const MAX_AVATAR_IMAGE_LENGTH = 32768;
// 仅接受前端压缩产物及常见静态图；拒绝 svg（可内嵌脚本）等非常规格式
const AVATAR_IMAGE_PREFIX_RE = /^data:image\/(jpeg|png|webp);base64,/;

/**
 * 校验头像图片 data URL。约定三态：
 * - undefined：未提供（跳过，不修改）
 * - null：清除头像
 * - string：必须是合法的图片 data URL 且不超过长度上限
 * 返回中文错误或 null
 */
export function validateAvatarImage(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !AVATAR_IMAGE_PREFIX_RE.test(value) ||
    value.length > MAX_AVATAR_IMAGE_LENGTH
  ) {
    return '头像图片无效或过大，请重新选择';
  }
  return null;
}

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

/** 校验密码长度（4~72 位），返回中文错误或 null */
export function validatePassword(password: string, label = '密码'): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `${label}长度至少为 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `${label}长度不能超过 ${MAX_PASSWORD_LENGTH} 位`;
  }
  return null;
}

/** 校验对局备注长度（不超过 200 字符），返回中文错误或 null */
export function validateGameNote(note: string): string | null {
  if (note.length > MAX_GAME_NOTE_LENGTH) {
    return `备注不能超过 ${MAX_GAME_NOTE_LENGTH} 个字符`;
  }
  return null;
}
