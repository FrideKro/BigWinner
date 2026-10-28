import { describe, expect, it } from 'vitest';
import { validateProfileLengths } from './profileValidation';

describe('validateProfileLengths', () => {
  it('未传或在上限内返回 null', () => {
    expect(validateProfileLengths({})).toBeNull();
    expect(
      validateProfileLengths({
        username: 'a'.repeat(64),
        nickname: '昵'.repeat(64),
        avatarColor: 'c'.repeat(32),
      }),
    ).toBeNull();
  });

  it('账号超过 64 个字符时报错', () => {
    expect(validateProfileLengths({ username: 'a'.repeat(65) })).toContain('登录账号');
  });

  it('昵称超过 64 个字符时报错', () => {
    expect(validateProfileLengths({ nickname: '昵'.repeat(65) })).toContain('昵称');
  });

  it('头像色超过 32 个字符时报错', () => {
    expect(validateProfileLengths({ avatarColor: 'c'.repeat(33) })).toContain('头像颜色');
  });
});
