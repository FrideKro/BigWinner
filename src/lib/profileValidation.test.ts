import { describe, expect, it } from 'vitest';
import { validateGameNote, validatePassword, validateProfileLengths } from './profileValidation';

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

describe('validatePassword', () => {
  it('4~72 位密码通过校验', () => {
    expect(validatePassword('1234')).toBeNull();
    expect(validatePassword('p'.repeat(72))).toBeNull();
  });

  it('不足 4 位或超过 72 位返回对应文案', () => {
    expect(validatePassword('123')).toBe('密码长度至少为 4 位');
    expect(validatePassword('123', '新密码')).toBe('新密码长度至少为 4 位');
    expect(validatePassword('p'.repeat(73))).toBe('密码长度不能超过 72 位');
    expect(validatePassword('p'.repeat(73), '初始密码')).toBe('初始密码长度不能超过 72 位');
  });
});

describe('validateGameNote', () => {
  it('200 字符以内通过，超过 200 字符报错', () => {
    expect(validateGameNote('')).toBeNull();
    expect(validateGameNote('备'.repeat(200))).toBeNull();
    expect(validateGameNote('备'.repeat(201))).toBe('备注不能超过 200 个字符');
  });
});
