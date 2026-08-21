import { useEffect } from 'react';

/**
 * 弹层打开期间锁定页面滚动（修复移动端滚动穿透）。
 * 用 position: fixed 而非 overflow: hidden：iOS Safari 对 body overflow: hidden
 * 不生效是经典问题，fixed 才能真正锁死；关闭时还原样式并恢复原滚动位置。
 * TeamPicker / EventPicker 共用。
 */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };
    const scrollY = window.scrollY;
    // 滚动条消失引起的布局抖动补偿（桌面端）
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.paddingRight = prev.paddingRight;
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    };
  }, [open]);
}

/** 弹层打开期间按 Escape 关闭 */
export function useEscapeKey(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}
