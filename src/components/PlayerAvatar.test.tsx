import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayerAvatar } from './PlayerAvatar';

afterEach(() => {
  cleanup();
});

describe('PlayerAvatar', () => {
  it('显示昵称前三个字', () => {
    render(<PlayerAvatar nickname="张三丰" />);

    expect(screen.getByText('张三丰')).toBeInTheDocument();
  });

  it('超长昵称截断为前三个字', () => {
    render(<PlayerAvatar nickname="欧阳夏丹青" />);

    expect(screen.getByText('欧阳夏')).toBeInTheDocument();
    expect(screen.queryByText('欧阳夏丹')).not.toBeInTheDocument();
  });

  it('大赢家显示皇冠角标', () => {
    render(<PlayerAvatar nickname="张三" isBigWinner />);

    expect(screen.getByTitle('当场大赢家')).toHaveTextContent('👑');
  });

  it('前三名显示对应奖牌角标', () => {
    const { rerender } = render(<PlayerAvatar nickname="张三" rank={1} />);
    expect(screen.getByText('🥇')).toBeInTheDocument();

    rerender(<PlayerAvatar nickname="张三" rank={2} />);
    expect(screen.getByText('🥈')).toBeInTheDocument();

    rerender(<PlayerAvatar nickname="张三" rank={3} />);
    expect(screen.getByText('🥉')).toBeInTheDocument();
  });

  it('第四名不显示奖牌角标', () => {
    render(<PlayerAvatar nickname="张三" rank={4} />);

    expect(screen.queryByText('🥇')).not.toBeInTheDocument();
    expect(screen.queryByText('🥈')).not.toBeInTheDocument();
    expect(screen.queryByText('🥉')).not.toBeInTheDocument();
  });

  it('已是大赢家时不再叠加奖牌角标', () => {
    render(<PlayerAvatar nickname="张三" rank={1} isBigWinner />);

    expect(screen.getByTitle('当场大赢家')).toBeInTheDocument();
    expect(screen.queryByText('🥇')).not.toBeInTheDocument();
  });

  it('有自定义头像图片时渲染 <img>，不显示文字', () => {
    render(<PlayerAvatar nickname="张三" src="data:image/jpeg;base64,QQ==" />);

    const img = screen.getByAltText('张三的头像');
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,QQ==');
    expect(screen.queryByText('张三')).not.toBeInTheDocument();
  });

  it('src 为空时落回昵称文字头像', () => {
    render(<PlayerAvatar nickname="张三" src={null} />);

    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.queryByAltText('张三的头像')).not.toBeInTheDocument();
  });

  it('图片头像与奖牌角标可同时存在', () => {
    render(<PlayerAvatar nickname="张三" src="data:image/jpeg;base64,QQ==" rank={2} />);

    expect(screen.getByAltText('张三的头像')).toBeInTheDocument();
    expect(screen.getByText('🥈')).toBeInTheDocument();
  });
});
