import { describe, expect, it } from 'vitest';
import { ROLE_BADGE_LABELS, ROLE_LABELS, USER_ROLES, parseUserRole } from './roles';

describe('parseUserRole', () => {
  it('接受三个合法角色', () => {
    expect(parseUserRole('ADMIN')).toBe('ADMIN');
    expect(parseUserRole('PLAYER')).toBe('PLAYER');
    expect(parseUserRole('TEMP_PLAYER')).toBe('TEMP_PLAYER');
  });

  it('拒绝非法与空值输入', () => {
    expect(parseUserRole('admin')).toBeNull(); // 大小写敏感，不做隐式归一
    expect(parseUserRole('player')).toBeNull();
    expect(parseUserRole('')).toBeNull();
    expect(parseUserRole('GUEST')).toBeNull();
    expect(parseUserRole(null)).toBeNull();
    expect(parseUserRole(undefined)).toBeNull();
    expect(parseUserRole(123)).toBeNull();
    expect(parseUserRole({})).toBeNull();
  });

  it('ROLE_LABELS 覆盖全部角色且文案非空', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_BADGE_LABELS[role]).toBeDefined();
    }
  });
});
