import { useEffect, useRef, useState } from 'react';

export function useSidebarNavigation(open: boolean, setOpen: (open: boolean) => void) {
  const root = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 760px)').matches);

  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!mobile || !element) return;
    let gesture: { x: number; y: number; time: number; horizontal: boolean } | null = null;
    const start = (event: TouchEvent) => {
      gesture = null;
      if (event.touches.length !== 1 || document.querySelector('dialog[open]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable], [role="slider"], [data-no-swipe]')) return;
      // Preserve horizontal tables and other independently scrollable controls.
      for (let node = target; node && node !== element; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
      }
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, time: performance.now(), horizontal: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { gesture = null; return; }
      const dx = event.touches[0].clientX - gesture.x;
      const dy = event.touches[0].clientY - gesture.y;
      if (!gesture.horizontal && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { gesture = null; return; }
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5 && (open ? dx < 0 : dx > 0)) {
        gesture.horizontal = true;
        if (event.cancelable) event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (gesture.horizontal && performance.now() - gesture.time < 1000 && Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5 && (open ? dx < 0 : dx > 0)) setOpen(!open);
      gesture = null;
    };
    const cancel = () => { gesture = null; };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: true });
    element.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [mobile, open, setOpen]);

  useEffect(() => {
    if (!mobile || !open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!document.querySelector('dialog[open]')) sidebar.current?.querySelector<HTMLElement>('button, a')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }, [mobile, open, setOpen]);

  return { root, sidebar, mobile };
}
