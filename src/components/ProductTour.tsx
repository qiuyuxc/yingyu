import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Compass, LoaderCircle, X } from 'lucide-react';
import { Button } from './ui';

type Step = 'welcome' | 'navigate' | 'choose' | 'visibility' | 'upload' | 'copy' | 'complete';
type Action = 'visibility-chosen' | 'upload-started' | 'upload-succeeded' | 'links-copied';
export type TourUploadState = { pending: number; done: number; failed: number; busy: boolean };
interface TourState {
  step: Step | null;
  upload: TourUploadState | null;
  start: () => void;
  begin: () => void;
  close: () => void;
  reportUpload: (value: TourUploadState) => void;
  notify: (action: Action) => void;
}
const TourContext = createContext<TourState>(null!);
export const useProductTour = () => useContext(TourContext);
const storageKey = (userId: string) => `yingyu-tour-v2:${userId}`;

export function ProductTourProvider({ userId, enabled, children }: { userId: string; enabled: boolean; children: ReactNode }) {
  const location = useLocation();
  const [step, setStep] = useState<Step | null>(() => {
    if (!enabled) return null;
    try { return localStorage.getItem(storageKey(userId)) === 'done' ? null : 'welcome'; } catch { return 'welcome'; }
  });
  const [upload, setUpload] = useState<TourUploadState | null>(null);
  const reportUpload = useCallback((value: TourUploadState) => setUpload(value), []);
  const notify = useCallback((action: Action) => setStep(current => {
    if (!current || current === 'welcome' || current === 'complete') return current;
    if (action === 'visibility-chosen' && current === 'visibility') return 'upload';
    if (action === 'upload-started' && ['choose', 'visibility', 'upload'].includes(current)) return 'upload';
    if (action === 'upload-succeeded' && current === 'upload') return 'copy';
    if (action === 'links-copied' && current === 'copy') return 'complete';
    return current;
  }), []);
  useEffect(() => {
    if (location.pathname !== '/app/upload') { setUpload(null); return; }
    if (step === 'navigate') { setStep('choose'); return; }
    if (!upload) return;
    if (step === 'choose' && !upload.busy) {
      if (upload.pending) setStep('visibility');
      else if (upload.done) setStep('copy');
    }
    if (['visibility', 'upload', 'copy'].includes(step || '') && !upload.busy && !upload.pending && !upload.done) setStep('choose');
    if (step === 'copy' && !upload.busy && !upload.done && upload.pending) setStep('visibility');
  }, [location.pathname, step, upload]);
  const close = () => {
    try { localStorage.setItem(storageKey(userId), 'done'); } catch {}
    setStep(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-tour-replay]')?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (step === 'complete') { try { localStorage.setItem(storageKey(userId), 'done'); } catch {} }
  }, [step, userId]);
  return <TourContext value={{ step, upload, start: () => setStep('welcome'), begin: () => setStep(location.pathname === '/app/upload' ? 'choose' : 'navigate'), close, reportUpload, notify }}>{children}</TourContext>;
}

const steps = {
  navigate: { target: '/app/upload', title: '先打开上传页', content: '点击高亮的“上传图片”，我们一起上传并分享一张图片。', task: '等待你打开上传页' },
  choose: { target: 'upload-choose', title: '选择一张图片', content: '点击高亮按钮，选择你想上传的图片。也可以拖入或粘贴图片，添加成功后会继续下一步。', task: '等待图片加入队列' },
  visibility: { target: 'upload-visibility', title: '决定谁可以看到它', content: '点选“公开”或“私密”。公开图片可通过外链分享；私密图片仅自己和管理员可见。', task: '等待你选择可见性' },
  upload: { target: 'upload-start', title: '把图片上传到你的空间', content: '点击高亮的上传按钮。图片会实际保存到你的账户并占用配额，成功后继续复制链接。', task: '等待你开始上传' },
  copy: { target: 'upload-copy', title: '复制刚上传的图片链接', content: '可以先切换直链、Markdown 等格式，再点击“复制全部链接”。复制成功后就完成了。', task: '等待链接复制成功' },
};
type Position = { left: number; top: number; width: number; height: number; cardLeft: number; cardTop: number };

export function ProductTour() {
  const { step, upload, begin, close } = useProductTour();
  const location = useLocation();
  const navigate = useNavigate();
  const card = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const active = step && step in steps ? steps[step as keyof typeof steps] : null;
  const paused = Boolean(active && step !== 'navigate' && location.pathname !== '/app/upload');
  const targetName = paused ? undefined : active?.target;

  useEffect(() => {
    if (!step) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [step, close]);

  useEffect(() => {
    setPosition(null);
    if (!targetName) {
      card.current?.querySelector<HTMLElement>('.tour-primary-action')?.focus({ preventScroll: true });
      return;
    }
    let target: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      if (!target?.isConnected) return;
      const rect = target.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight;
      const cardWidth = card.current?.offsetWidth || 330, cardHeight = card.current?.offsetHeight || 230;
      const beside = rect.right + cardWidth + 36 < width;
      const above = rect.top - cardHeight - 20;
      const below = rect.bottom + 20;
      const next = {
        left: Math.max(4, rect.left - 5), top: Math.max(4, rect.top - 5), width: rect.width + 10, height: rect.height + 10,
        cardLeft: beside ? rect.right + 20 : Math.max(16, Math.min(width - cardWidth - 16, rect.left)),
        cardTop: Math.max(16, Math.min(height - cardHeight - 16, beside ? rect.top : above >= 16 ? above : below + cardHeight < height - 16 ? below : height - cardHeight - 16)),
      };
      setPosition(previous => previous && Object.entries(next).every(([key, value]) => Math.abs(previous[key as keyof Position] - value) < .5) ? previous : next);
    };
    const resize = new ResizeObserver(measure);
    if (card.current) resize.observe(card.current);
    const locate = () => {
      const found = document.querySelector<HTMLElement>(`[data-tour="${targetName}"]`);
      if (found !== target) {
        if (target) resize.unobserve(target);
        target = found;
        if (!target) { setPosition(null); return; }
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        resize.observe(target);
        const control = target.matches('button, a, input') ? target : target.querySelector<HTMLElement>('button:not(:disabled), a, input');
        control?.focus({ preventScroll: true });
      }
      measure();
    };
    locate();
    const until = performance.now() + 350;
    const animate = () => { locate(); if (performance.now() < until) frame = requestAnimationFrame(animate); };
    animate();
    const mutations = new MutationObserver(locate);
    const workspace = document.querySelector('.workspace');
    if (workspace) mutations.observe(workspace, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [targetName, location.pathname, step]);

  if (!step) return null;
  const number = active ? Object.keys(steps).indexOf(step) + 1 : 0;
  const uploading = step === 'upload' && upload?.busy;
  const failed = step === 'upload' && !upload?.busy && Boolean(upload?.failed);
  return <div className="product-tour" data-tour-step={step}>
    {position && !paused ? <div className="tour-spotlight" aria-hidden="true" style={{ left: position.left, top: position.top, width: position.width, height: position.height }} /> : <div className="tour-backdrop" aria-hidden="true" />}
    <section ref={card} role="dialog" aria-modal="false" aria-label="使用引导" aria-describedby="tour-description" className={'tour-card ' + (!position || paused ? 'tour-card-centered' : '')} style={position && !paused ? { left: position.cardLeft, top: position.cardTop } : undefined}>
      <div className="tour-caption"><span><Compass size={15} />操作引导{active && ` · ${number} / 5`}</span><button type="button" className="icon-button" aria-label="关闭使用引导" onClick={close}><X size={16} /></button></div>
      <div aria-live="polite" aria-atomic="true"><h2>{step === 'welcome' ? '一起上传并分享一张图片' : step === 'complete' ? '上传和分享，你已经学会了' : paused ? '引导已暂停' : active!.title}</h2><p id="tour-description">{step === 'welcome' ? '跟随高亮提示，亲手完成选图、设置可见性、上传和复制链接。每一步完成后会自动继续，随时可以退出。' : step === 'complete' ? '图片已保存在你的账户，链接已复制。以后可以在“我的图片”中查看、整理或删除它。' : paused ? '你离开了上传页。准备好后回到上传页继续，或者结束这次引导。' : active!.content}</p></div>
      {active && !paused && <><div className="tour-task" role="status">{uploading ? <LoaderCircle size={13} className="spin" /> : <span className="tour-task-dot" />}<span>{uploading ? '正在上传，成功后自动继续…' : failed ? '上传失败，请查看队列中的原因并点击重试' : active.task}</span></div><div className="tour-progress" aria-hidden="true">{Object.keys(steps).map((name, index) => <span key={name} className={index < number ? 'active' : ''} />)}</div></>}
      <div className="tour-actions"><Button type="button" variant="ghost" onClick={close}>{step === 'complete' ? '完成引导' : '跳过引导'}</Button>{step === 'welcome' ? <Button type="button" className="tour-primary-action" variant="primary" onClick={begin}>开始操作<ArrowRight size={14} /></Button> : step === 'complete' ? <Link className="button primary tour-primary-action" to="/app" onClick={close}><Check size={14} />查看我的图片</Link> : paused ? <Button type="button" className="tour-primary-action" variant="primary" onClick={() => navigate('/app/upload')}>返回上传页<ArrowRight size={14} /></Button> : <small>完成操作后自动继续</small>}</div>
    </section>
  </div>;
}
