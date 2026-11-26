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
const AVATAR_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function hasValidImageMagicBytes(format: 'jpeg' | 'png' | 'webp', b64: string): boolean {
  if (b64.length % 4 !== 0) return false;
  // 仅解码前 16 个 base64 字符（最多 12 字节），即可覆盖 JPEG / PNG / WebP 文件头魔数
  let bin: string;
  try {
    bin = atob(b64.slice(0, 16));
  } catch {
    return false;
  }
  const b = (idx: number) => (idx < bin.length ? bin.charCodeAt(idx) : -1);
  if (format === 'jpeg') {
    return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  }
  if (format === 'png') {
    return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  }
  // WebP: RIFF....WEBP
  return (
    bin.length >= 12 &&
    b(0) === 0x52 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x46 &&
    b(8) === 0x57 &&
    b(9) === 0x45 &&
    b(10) === 0x42 &&
    b(11) === 0x50
  );
}

/**
 * 校验头像图片 data URL。约定三态：
 * - undefined：未提供（跳过，不修改）
 * - null：清除头像
 * - string：必须是合法的图片 data URL（校验 base64 格式与图片文件头魔数）且不超过长度上限
 * 返回中文错误或 null
 */
export function validateAvatarImage(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_AVATAR_IMAGE_LENGTH) {
    return '头像图片无效或过大，请重新选择';
  }
  const match = AVATAR_IMAGE_DATA_URL_RE.exec(value);
  if (!match) {
    return '头像图片无效或过大，请重新选择';
  }
  const format = match[1] as 'jpeg' | 'png' | 'webp';
  if (!hasValidImageMagicBytes(format, match[2])) {
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
