import { Link } from 'react-router-dom';
import { ArrowRight, Check, CloudUpload, FolderHeart, HardDrive, Heart, Image, Leaf, LockKeyhole, Moon, ShieldCheck, Sparkles, Sun, WandSparkles } from 'lucide-react';
import { formatBytes } from '../api';
import { useAuth, useTheme } from '../context';
import { Logo } from '../components/ui';
import { HeroGallery } from '../components/HeroGallery';
import { useHomeMotion } from '../components/useHomeMotion';

export function Home() {
  const motionRef = useHomeMotion();
  const { user, site } = useAuth();
  const { dark, setTheme } = useTheme();
  const settings = site!.settings;
  const destination = user ? '/app' : '/register';
  const features = [
    { icon: CloudUpload, title: '拖进来，就存好了', text: '拖拽、粘贴或批量选择，一次收好你的图片。' },
    { icon: FolderHeart, title: '灵感，井然有序', text: '用相册归档，用收藏标记，轻松找到每一帧。' },
    { icon: Image, title: '分享，只需一瞬', text: '图片直链、Markdown、HTML，复制即用。' },
    { icon: LockKeyhole, title: '公开，或只属于你', text: '自由选择公开与私密，让分享始终由你决定。' },
  ];
  return <div className="public-page" ref={motionRef}><header className="public-nav glass"><Link to="/" aria-label="映屿首页"><Logo small /></Link><nav aria-label="官网导航"><a href="#features">功能</a><a href="#space">免费空间</a><a href="#questions">常见问题</a></nav><div className="public-nav-actions"><button className="icon-button" aria-label={dark ? '切换浅色外观' : '切换深色外观'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button><Link to={user ? '/app' : '/login'} className="nav-login">{user ? '我的空间' : '登录'}</Link><Link to={destination} className="button primary button-small">{user ? '进入工作台' : '开始使用'}<ArrowRight size={12} /></Link></div></header>
    <main><section className="hero"><div className="hero-copy"><h1>让图片，<br /><em>自由流动。</em></h1><p>{settings.tagline}<br />从日常一瞬，到创作灵感，轻盈存放，自在分享。</p><div className="hero-actions"><Link to={destination} className="button primary hero-button"><CloudUpload size={16} />{user ? '进入我的空间' : '拥有我的小岛'}<ArrowRight size={14} /></Link><a href="#features" className="hero-secondary">了解映屿 <ArrowRight size={13} /></a></div><div className="hero-notes"><span><Check size={12} />免费 {formatBytes(settings.defaultQuotaBytes)} 起</span><span><Check size={12} />无需绑定支付</span><span><Check size={12} />按需申请扩容</span></div></div>
    <div className="hero-visual" aria-label="示例相册展示"><div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" /><span className="visual-spark spark-one"><Sparkles size={20} /></span><span className="visual-spark spark-two"><Leaf size={19} /></span><div className="floating-chip glass"><span className="chip-icon"><ShieldCheck size={17} /></span><span>妥善存放<br /><strong>安心分享</strong></span></div>
      <HeroGallery />
      <div className="floating-storage glass"><span className="chip-icon"><HardDrive size={18} /></span><div><span>给灵感，多一点空间</span><strong>{formatBytes(settings.defaultQuotaBytes)} <small>免费起步</small></strong><div className="progress-track"><span style={{ width: '28%' }} /></div></div><span className="tiny-plus">+</span></div></div>
    </section>
    <div className="home-divider"><span>轻一点的界面，多一点的热爱。</span></div>
    <section id="features" className="features-section"><div className="section-heading"><h2>刚刚好的功能，<span>不多不少。</span></h2><p>把复杂留给我们，把专注留给创作。</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, text }, i) => <article key={title} className="feature"><span className={'feature-icon color-' + i}><Icon size={21} strokeWidth={1.5} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section id="space" className="space-section glass"><div className="space-copy"><h2>空间可以扩容，<br />热爱无需付费。</h2><p>映屿是一个免费的图片住处。<br />当你的创作需要更多空间，告诉我们就好。</p><Link to={user ? '/app/quota' : '/register'} className="button secondary">了解我的空间 <ArrowRight size={13} /></Link></div><div className="quota-steps"><article><span className="step-number">01</span><div><h3>免费起步</h3><p>注册即可获得 {formatBytes(settings.defaultQuotaBytes)} 存储空间。</p></div><Check size={15} /></article><article><span className="step-number">02</span><div><h3>按需申请</h3><p>填写所需总空间与用途，提交扩容申请。</p></div><WandSparkles size={15} /></article><article><span className="step-number">03</span><div><h3>管理员调配</h3><p>管理员审核并分配额度，无需在线支付。</p></div><ShieldCheck size={15} /></article></div></section>
    <section id="questions" className="faq-section"><div className="section-heading"><h2>也许你想知道</h2></div><div className="faq-list"><details><summary>支持上传哪些图片？<span>+</span></summary><p>支持 JPG、PNG、GIF、WebP 和 AVIF，单张图片最多 {formatBytes(settings.maxUploadBytes)}。上传时会校验实际文件格式。</p></details><details><summary>私密图片能通过外链访问吗？<span>+</span></summary><p>私密图片仅对登录的图片所有者和站点管理员开放。需要在博客或论坛展示时，请将图片设为公开。</p></details><details><summary>删除图片后会归还空间吗？<span>+</span></summary><p>会。存储中的图片删除成功后，所占空间会归还到你的配额，原图片链接将失效。</p></details><details><summary>扩容需要付费吗？<span>+</span></summary><p>不需要。配额由管理员根据实际用途分配。你可以在“空间与配额”中提交申请并查看审核结果。</p></details></div></section>
    <section className="home-final"><span><Sparkles size={18} /></span><h2>下一份灵感，从这里开始。</h2><Link to={destination} className="button primary">{user ? '回到我的空间' : '免费创建账号'}<ArrowRight size={14} /></Link></section></main>
    <footer className="public-footer"><Link to="/"><Logo small /></Link><span>为每一份热爱留白。 © {new Date().getFullYear()} {settings.siteName}</span><span><Heart size={11} /> 轻盈，始终如一</span></footer>
  </div>;
}
