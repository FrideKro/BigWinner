import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_IMAGE_DIMENSION, fileToAvatarDataUrl } from './avatarImage';

// jsdom 无 canvas 2D 上下文与 blob URL 能力，桩掉解码与绘制链路，
// 只验证裁剪参数、压缩产物与错误分支
const drawImage = vi.fn();
const toDataURL = vi.fn();

function stubEnv(
  options: {
    naturalWidth?: number;
    naturalHeight?: number;
    loadFail?: boolean;
    ctxNull?: boolean;
  } = {},
) {
  const { naturalWidth = 300, naturalHeight = 200, loadFail = false, ctxNull = false } = options;
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = naturalWidth;
      naturalHeight = naturalHeight;
      onload: () => void = () => {};
      onerror: () => void = () => {};
      set src(_value: string) {
        if (loadFail) this.onerror();
        else this.onload();
      }
    },
  );
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
  const fakeCtx = ctxNull ? null : { drawImage };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => fakeCtx,
        toDataURL,
      } as unknown as HTMLCanvasElement;
    }
    throw new Error(`测试未覆盖的 createElement 调用: ${tag}`);
  }) as typeof document.createElement);
}

function makeFile(type: string, sizeBytes: number) {
  // File 体积由内容撑起：超限用例直接塞大数组
  const chunk = new Uint8Array(Math.min(sizeBytes, 1024 * 1024));
  const file = new File([chunk], 'avatar.jpg', { type });
  if (sizeBytes > chunk.length) {
    Object.defineProperty(file, 'size', { value: sizeBytes });
  }
  return file;
}

describe('fileToAvatarDataUrl', () => {
  beforeEach(() => {
    drawImage.mockReset();
    toDataURL.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('居中裁方并压缩为 128×128 JPEG data URL', async () => {
    toDataURL.mockReturnValue('data:image/jpeg;base64,QQ==');
    stubEnv({ naturalWidth: 300, naturalHeight: 200 });

    const result = await fileToAvatarDataUrl(makeFile('image/jpeg', 1024));

    expect(result).toBe('data:image/jpeg;base64,QQ==');
    // 居中裁方：取短边 200，水平方向偏移 (300-200)/2 = 50
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      50,
      0,
      200,
      200,
      0,
      0,
      AVATAR_IMAGE_DIMENSION,
      AVATAR_IMAGE_DIMENSION,
    );
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
    // blob URL 用后即回收
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('非图片文件直接拒绝', async () => {
    stubEnv();

    await expect(fileToAvatarDataUrl(makeFile('text/plain', 16))).rejects.toThrow('请选择图片文件');
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('原始文件超过 10MB 拒绝', async () => {
    stubEnv();

    await expect(fileToAvatarDataUrl(makeFile('image/jpeg', 11 * 1024 * 1024))).rejects.toThrow(
      '图片太大',
    );
  });

  it('图片解码失败给出中文错误', async () => {
    stubEnv({ loadFail: true });

    await expect(fileToAvatarDataUrl(makeFile('image/jpeg', 1024))).rejects.toThrow(
      '图片读取失败，请换一张试试',
    );
  });

  it('canvas 2D 上下文不可用时给出中文错误', async () => {
    stubEnv({ ctxNull: true });

    await expect(fileToAvatarDataUrl(makeFile('image/jpeg', 1024))).rejects.toThrow(
      '当前浏览器不支持图片压缩',
    );
  });
});
