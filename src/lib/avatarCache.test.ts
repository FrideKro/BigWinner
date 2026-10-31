import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  avatarMapFromCache,
  diffAvatarVersions,
  loadAvatarCache,
  putAvatar,
  saveAvatarCache,
  type AvatarCache,
} from './avatarCache';

const players = [
  { id: 1, avatarVersion: 2 },
  { id: 2, avatarVersion: 0 },
  { id: 3, avatarVersion: 5 },
];

function seedStorage(cache: AvatarCache) {
  localStorage.setItem('bw_avatar_cache', JSON.stringify(cache));
}

describe('loadAvatarCache', () => {
  beforeEach(() => localStorage.clear());

  it('无缓存 / 坏 JSON / 非对象数据返回空表', () => {
    expect(loadAvatarCache()).toEqual({});
    localStorage.setItem('bw_avatar_cache', 'not-json');
    expect(loadAvatarCache()).toEqual({});
    localStorage.setItem('bw_avatar_cache', '[1,2]');
    expect(loadAvatarCache()).toEqual({});
  });

  it('过滤形状非法的条目，合法条目原样读出', () => {
    // 故意混入形状非法的条目（模拟坏数据/旧版本格式），需逃逸类型检查
    const dirty = {
      '1': { v: 2, src: 'data:image/jpeg;base64,QQ==' },
      bad1: { v: 'x', src: null },
      bad2: { v: 1 },
      bad3: null,
    } as unknown as AvatarCache;
    seedStorage(dirty);

    expect(loadAvatarCache()).toEqual({ '1': { v: 2, src: 'data:image/jpeg;base64,QQ==' } });
  });
});

describe('diffAvatarVersions', () => {
  beforeEach(() => localStorage.clear());

  it('缓存缺失与版本不一致的玩家进入待拉取列表', () => {
    const cache: AvatarCache = {
      '1': { v: 2, src: 'data:image/jpeg;base64,QQ==' },
      '3': { v: 4, src: null },
    };

    expect(diffAvatarVersions(players, cache)).toEqual([
      { id: 2, version: 0 },
      { id: 3, version: 5 },
    ]);
  });

  it('版本全部一致时返回空列表', () => {
    const cache: AvatarCache = {
      '1': { v: 2, src: null },
      '2': { v: 0, src: null },
      '3': { v: 5, src: 'data:image/jpeg;base64,QQ==' },
    };

    expect(diffAvatarVersions(players, cache)).toEqual([]);
  });

  it('avatarVersion 缺省按 0 处理', () => {
    expect(diffAvatarVersions([{ id: 9 }], { '9': { v: 0, src: null } })).toEqual([]);
  });
});

describe('putAvatar / avatarMapFromCache / saveAvatarCache', () => {
  beforeEach(() => localStorage.clear());

  it('putAvatar 不可变更新，src 允许 null（负缓存）', () => {
    const base = putAvatar({}, 1, 2, 'data:image/jpeg;base64,QQ==');
    const next = putAvatar(base, 2, 0, null);

    expect(next['1']).toEqual({ v: 2, src: 'data:image/jpeg;base64,QQ==' });
    expect(next['2']).toEqual({ v: 0, src: null });
    expect(base['2']).toBeUndefined();
  });

  it('avatarMapFromCache 只收录有图的玩家', () => {
    const cache: AvatarCache = {
      '1': { v: 2, src: 'data:image/jpeg;base64,QQ==' },
      '2': { v: 0, src: null },
    };

    expect(avatarMapFromCache(players, cache)).toEqual(
      new Map([[1, 'data:image/jpeg;base64,QQ==']]),
    );
  });

  it('save 后可完整读回', () => {
    const cache = putAvatar(putAvatar({}, 1, 2, 'data:image/png;base64,AA=='), 3, 5, null);
    saveAvatarCache(cache);

    expect(loadAvatarCache()).toEqual(cache);
  });

  it('持久化失败（容量满/隐私模式）不抛错', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveAvatarCache({ '1': { v: 1, src: null } })).not.toThrow();
    vi.restoreAllMocks();
  });
});
