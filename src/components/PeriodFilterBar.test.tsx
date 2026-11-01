import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PeriodFilterBar,
  defaultCustomRange,
  parseStoredPeriodFilter,
  periodFilterQuery,
  type PeriodFilterValue,
} from './PeriodFilterBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('periodFilterQuery', () => {
  it('固定周期输出 period 参数', () => {
    expect(periodFilterQuery({ kind: 'all' })).toBe('period=all');
    expect(periodFilterQuery({ kind: 'month' })).toBe('period=month');
  });

  it('自定义区间输出 from/to 参数', () => {
    expect(periodFilterQuery({ kind: 'range', from: '2025-03-01', to: '2025-03-10' })).toBe(
      'from=2025-03-01&to=2025-03-10',
    );
  });
});

describe('defaultCustomRange', () => {
  it('默认区间为前天至指定今天', () => {
    expect(defaultCustomRange('2025-03-15')).toEqual({ from: '2025-03-13', to: '2025-03-15' });
  });

  it('前天跨月/跨年时自动进位', () => {
    expect(defaultCustomRange('2025-03-01')).toEqual({ from: '2025-02-27', to: '2025-03-01' });
    expect(defaultCustomRange('2026-01-01')).toEqual({ from: '2025-12-30', to: '2026-01-01' });
  });
});

describe('parseStoredPeriodFilter', () => {
  it('缺失 / 损坏 JSON / 未知形状一律回退「全部」', () => {
    expect(parseStoredPeriodFilter(null)).toEqual({ kind: 'all' });
    expect(parseStoredPeriodFilter('')).toEqual({ kind: 'all' });
    expect(parseStoredPeriodFilter('{not-json')).toEqual({ kind: 'all' });
    expect(parseStoredPeriodFilter(JSON.stringify({ kind: 'abc' }))).toEqual({ kind: 'all' });
    expect(parseStoredPeriodFilter(JSON.stringify({ foo: 1 }))).toEqual({ kind: 'all' });
  });

  it('合法固定周期原样恢复', () => {
    expect(parseStoredPeriodFilter(JSON.stringify({ kind: 'month' }))).toEqual({ kind: 'month' });
    expect(parseStoredPeriodFilter(JSON.stringify({ kind: 'year' }))).toEqual({ kind: 'year' });
  });

  it('合法自定义区间原样恢复', () => {
    expect(
      parseStoredPeriodFilter(
        JSON.stringify({ kind: 'range', from: '2025-03-01', to: '2025-03-10' }),
      ),
    ).toEqual({ kind: 'range', from: '2025-03-01', to: '2025-03-10' });
  });

  it('区间日期形状非法或 from 大于 to 回退「全部」', () => {
    for (const value of [
      { kind: 'range', from: '2025-3-1', to: '2025-03-10' },
      { kind: 'range', from: '', to: '2025-03-10' },
      { kind: 'range', from: 1, to: 2 },
      { kind: 'range', from: '2025-03-10', to: '2025-03-01' },
    ]) {
      expect(parseStoredPeriodFilter(JSON.stringify(value))).toEqual({ kind: 'all' });
    }
  });
});

describe('PeriodFilterBar', () => {
  function setup(value: PeriodFilterValue) {
    const onChange = vi.fn();
    render(<PeriodFilterBar value={value} onChange={onChange} />);
    return { onChange };
  }

  it('渲染四个周期选项并高亮当前选中', () => {
    setup({ kind: 'month' });

    for (const label of ['全部', '本年', '本月', '自定义']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '本月' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByLabelText('开始日期')).not.toBeInTheDocument();
  });

  it('点击固定周期直接向外抛出对应 kind', () => {
    const { onChange } = setup({ kind: 'all' });

    fireEvent.click(screen.getByRole('button', { name: '本年' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'year' });
  });

  it('从固定周期切入自定义时抛出默认区间（前天 ~ 今天）', () => {
    // 固定上海时区时钟：UTC 2025-03-15 10:00 → 上海 2025-03-15 18:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-15T10:00:00Z'));
    const { onChange } = setup({ kind: 'all' });

    fireEvent.click(screen.getByRole('button', { name: '自定义' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: '2025-03-13', to: '2025-03-15' });
  });

  it('已是自定义时再次点击自定义不重复抛出', () => {
    const { onChange } = setup({ kind: 'range', from: '2025-03-01', to: '2025-03-10' });

    fireEvent.click(screen.getByRole('button', { name: '自定义' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('自定义展开起止日期输入并回显当前区间', () => {
    setup({ kind: 'range', from: '2025-03-01', to: '2025-03-10' });

    expect(screen.getByLabelText('开始日期')).toHaveValue('2025-03-01');
    expect(screen.getByLabelText('结束日期')).toHaveValue('2025-03-10');
  });

  it('修改开始日期越过结束日时收口同步结束日', () => {
    const { onChange } = setup({ kind: 'range', from: '2025-03-01', to: '2025-03-10' });

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-03-20' } });

    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: '2025-03-20', to: '2025-03-20' });
  });

  it('修改结束日期早于开始日时收口同步开始日', () => {
    const { onChange } = setup({ kind: 'range', from: '2025-03-05', to: '2025-03-10' });

    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-03-01' } });

    expect(onChange).toHaveBeenCalledWith({ kind: 'range', from: '2025-03-01', to: '2025-03-01' });
  });

  it('清空日期输入被忽略，不向外抛不完整区间', () => {
    const { onChange } = setup({ kind: 'range', from: '2025-03-01', to: '2025-03-10' });

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
