// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseNonNegativeInt, parsePositiveInt } from './params';

describe('parsePositiveInt', () => {
  it('接受纯数字正整数', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt('42')).toBe(42);
  });

  it('拒绝宽松 parseInt 会截断的非法输入', () => {
    expect(parsePositiveInt('12abc')).toBeNull();
    expect(parsePositiveInt(' 12')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('-3')).toBeNull();
    expect(parsePositiveInt('+3')).toBeNull();
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
  });

  it('拒绝超出安全整数范围的输入', () => {
    expect(parsePositiveInt('9007199254740993')).toBeNull();
  });
});

describe('parseNonNegativeInt', () => {
  it('允许 0 与正整数', () => {
    expect(parseNonNegativeInt('0')).toBe(0);
    expect(parseNonNegativeInt('2000')).toBe(2000);
  });

  it('拒绝非法输入', () => {
    expect(parseNonNegativeInt('12abc')).toBeNull();
    expect(parseNonNegativeInt('-1')).toBeNull();
    expect(parseNonNegativeInt('1e3')).toBeNull();
    expect(parseNonNegativeInt('')).toBeNull();
    expect(parseNonNegativeInt(null)).toBeNull();
  });
});
