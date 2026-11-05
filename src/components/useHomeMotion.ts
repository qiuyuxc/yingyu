import { useEffect, useRef } from 'react';

export function useHomeMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const visual = root.querySelector<HTMLElement>('.hero-visual');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let stop = () => {};

    const configure = () => {
      stop();
      if (media.matches || !visual) return;
      let frame = 0;
      let active = true;
      let top = 0;
      let height = 1;
      const update = () => {
        frame = 0;
        const start = Math.max(0, top - window.innerHeight * .28);
        const progress = Math.max(0, Math.min(1, (window.scrollY - start) / (top + height * .82 - start)));
        visual.style.setProperty('--scroll-opacity', String(1 - progress));
        visual.style.setProperty('--scroll-shift', `${-progress * 55}px`);
      };
      const schedule = () => { if (active && !frame) frame = requestAnimationFrame(update); };
      const measure = () => {
        const rect = visual.getBoundingClientRect();
        top = rect.top + window.scrollY;
        height = rect.height;
        update();
      };
      const visible = new IntersectionObserver(([entry]) => { active = entry.isIntersecting; update(); });
      visible.observe(visual);
      const resize = new ResizeObserver(measure);
      resize.observe(root);
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', measure);
      const reveals = root.querySelectorAll<HTMLElement>('.section-heading, .feature, .space-section, .faq-list, .home-final');
      const reveal = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = 'true';
          reveal.unobserve(entry.target);
        }
      }, { threshold: .08 });
      reveals.forEach(element => reveal.observe(element));
      measure();
      stop = () => {
        cancelAnimationFrame(frame);
        visible.disconnect(); resize.disconnect(); reveal.disconnect();
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', measure);
        visual.style.removeProperty('--scroll-opacity');
        visual.style.removeProperty('--scroll-shift');
        reveals.forEach(element => delete element.dataset.revealed);
      };
    };
    configure();
    media.addEventListener('change', configure);
    return () => { stop(); media.removeEventListener('change', configure); };
  }, []);
  return ref;
}
