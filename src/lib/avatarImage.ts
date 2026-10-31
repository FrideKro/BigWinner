// 头像图片前端压缩：相册选图 → canvas 居中裁方 → 小尺寸 JPEG data URL（几 KB 量级），
// 服务端仅存 data URL，不做文件上传与二次处理
export const AVATAR_IMAGE_DIMENSION = 128;
const AVATAR_IMAGE_QUALITY = 0.78;
// 原始文件大小上限，防超大图拖慢解码（压缩后另有服务端 data URL 长度校验兜底）
const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;

/** 校验并压缩头像图片，成功返回 data:image/jpeg;base64,...；失败抛中文错误 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (file.size > MAX_INPUT_FILE_BYTES) {
    throw new Error('图片太大，请换一张小于 10MB 的图片');
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_IMAGE_DIMENSION;
    canvas.height = AVATAR_IMAGE_DIMENSION;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('当前浏览器不支持图片压缩，请换一张试试');
    }
    // 居中裁方：取较短边为边长，避免非方形图片被拉伸变形
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_IMAGE_DIMENSION, AVATAR_IMAGE_DIMENSION);
    return canvas.toDataURL('image/jpeg', AVATAR_IMAGE_QUALITY);
  } catch (err) {
    if (err instanceof Error && err.message) {
      throw err;
    }
    throw new Error('图片读取失败，请换一张试试');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败，请换一张试试'));
    img.src = src;
  });
}
