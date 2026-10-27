import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEditorModal, PlayerOption } from './GameEditorModal';

const players: PlayerOption[] = [
  { id: 1, nickname: '张三', avatarColor: 'red', isActive: true },
  { id: 2, nickname: '李四', avatarColor: 'amber', isActive: true },
  { id: 3, nickname: '王五', avatarColor: 'emerald', isActive: true },
  { id: 4, nickname: '赵六', avatarColor: 'blue', isActive: true },
  { id: 5, nickname: '钱七', avatarColor: 'purple', isActive: false },
];

function stubFetch(saveResponse: { ok: boolean; body: Record<string, unknown> }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/users')) {
      return { ok: true, json: async () => ({ users: players }) };
    }
    return { ok: saveResponse.ok, json: async () => saveResponse.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderModal(overrides?: Partial<Parameters<typeof GameEditorModal>[0]>) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <GameEditorModal
      open
      players={players}
      defaultRoomFee={100}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onSaved, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GameEditorModal', () => {
  it('open=false 时不渲染任何内容', () => {
    const { container } = render(
      <GameEditorModal
        open={false}
        players={players}
        defaultRoomFee={100}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('新建场次默认选中前 4 名活跃玩家，未配平时保存禁用并提示待配平', async () => {
    stubFetch({ ok: true, body: {} });
    const user = userEvent.setup();
    renderModal();

    // 等待弹窗打开时的玩家列表兜底刷新完成
    await waitFor(() => expect(screen.getByText('上桌玩家（已选 4 人）')).toBeInTheDocument());

    const amountInputs = screen.getAllByPlaceholderText('金额');
    expect(amountInputs).toHaveLength(4);

    // 张三 +200，李四、王五填 0，赵六留空
    await user.type(amountInputs[0], '200');
    await user.type(amountInputs[1], '0');
    await user.type(amountInputs[2], '0');

    // 房费默认 100：玩家合计 +200 + 房费 +100 = +300，且赵六未填金额
    expect(screen.getByText('请填完所有玩家金额')).toBeInTheDocument();

    await user.type(amountInputs[3], '0');
    expect(screen.getByText('还差 +300 待配平')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '确认记账' })).toBeDisabled();
  });

  it('一键配平后可保存：POST /api/games 载荷正确并回调 onSaved', async () => {
    const fetchMock = stubFetch({ ok: true, body: { id: 9 } });
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users'));
    const amountInputs = screen.getAllByPlaceholderText('金额');
    await user.type(amountInputs[0], '200');
    await user.type(amountInputs[1], '0');
    await user.type(amountInputs[2], '0');

    // 对赵六一键配平：-(200 + 0 + 0 + 房费 100) = -300
    const balanceButtons = screen.getAllByTitle('按其他人+房费自动配平');
    await user.click(balanceButtons[3]);

    expect(screen.getByText('账目已配平 ✓')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: '确认记账' });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, saveInit] = fetchMock.mock.calls[1] as unknown as [
      RequestInfo | URL,
      RequestInit | undefined,
    ];
    expect(fetchMock.mock.calls[1][0]).toBe('/api/games');
    expect(saveInit?.method).toBe('POST');

    const payload = JSON.parse(String(saveInit?.body));
    expect(payload.roomFee).toBe(100);
    expect(payload.records).toEqual([
      { userId: 1, amount: 200 },
      { userId: 2, amount: 0 },
      { userId: 3, amount: 0 },
      { userId: 4, amount: -300 },
    ]);
  });

  it('服务端返回错误时在弹窗内显示错误提示且不回调 onSaved', async () => {
    const fetchMock = stubFetch({
      ok: false,
      body: { error: '同一场次不能重复选择同一名玩家' },
    });
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users'));
    const amountInputs = screen.getAllByPlaceholderText('金额');
    await user.type(amountInputs[0], '200');
    await user.type(amountInputs[1], '0');
    await user.type(amountInputs[2], '0');
    await user.click(screen.getAllByTitle('按其他人+房费自动配平')[3]);

    await user.click(screen.getByRole('button', { name: '确认记账' }));

    expect(await screen.findByText('同一场次不能重复选择同一名玩家')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
