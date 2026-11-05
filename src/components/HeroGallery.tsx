import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Pause, Play } from 'lucide-react';

const photos = [
  { src: '/samples/lake.jpg', alt: '湖畔的山与安静的小屋', title: '山间来信', label: '01 / 自然' },
  { src: '/samples/forest.jpg', alt: '阳光穿过森林', title: '一抹绿意', label: '02 / 森林' },
  { src: '/samples/mountain.jpg', alt: '阳光下的山峰', title: '远方有山', label: '03 / 远山' },
];

export function HeroGallery() {
  const ref = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(media.matches);
    const onVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    if (ref.current) observer.observe(ref.current);
    media.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (paused || hovered || focused || reduced || !visible || !pageVisible) return;
    const timer = window.setTimeout(() => setCurrent(value => (value + 1) % photos.length), 5200);
    return () => window.clearTimeout(timer);
  }, [current, paused, hovered, focused, reduced, visible, pageVisible]);

  return <div ref={ref} className="hero-gallery glass" role="region" aria-roledescription="轮播" aria-label="示例图片轮播"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="hero-gallery-bar"><span className="window-dots"><i /><i /><i /></span><span>生活的切片</span><small>示例相册</small></div>
    <div className="hero-gallery-grid">
      {[0, 1, 2].map(slot => <div className={'showcase-photo' + (slot === 0 ? ' large' : '')} key={slot}>
        {photos.map((_, slide) => {
          const photo = photos[(slide + slot) % photos.length];
          return <div key={slide} className={'showcase-frame' + (slide === current ? ' active' : '')} aria-hidden={slide !== current}>
            <img src={photo.src} alt={photo.alt} fetchPriority={slot === 0 && slide === 0 ? 'high' : 'auto'} />
            <span>{photo.title}{slot === 0 && <small>{photo.label}</small>}</span>
          </div>;
        })}
      </div>)}
    </div>
    <div className="hero-gallery-footer"><span><Layers size={12} />收好每一份热爱</span>
      <div className="gallery-controls">
        <button type="button" className="icon-button" aria-label="上一组示例图片" onClick={() => setCurrent(value => (value + photos.length - 1) % photos.length)}><ChevronLeft size={13} /></button>
        <div className="gallery-dots">{photos.map((photo, index) => <button type="button" key={photo.src} aria-label={'显示第 ' + (index + 1) + ' 组示例图片'} aria-pressed={current === index} onClick={() => setCurrent(index)} />)}</div>
        <button type="button" className="icon-button" aria-label="下一组示例图片" onClick={() => setCurrent(value => (value + 1) % photos.length)}><ChevronRight size={13} /></button>
        {!reduced && <button type="button" className="icon-button" aria-label={paused ? '播放图片轮播' : '暂停图片轮播'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={11} /> : <Pause size={11} />}</button>}
      </div>
    </div>
  </div>;
}
