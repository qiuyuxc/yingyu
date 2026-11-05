import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Palette } from '../context';

const palettes: { value: Palette; label: string }[] = [
  { value: 'mono', label: '系统黑白' },
  { value: 'green', label: '森林绿' },
  { value: 'blue', label: '雾蓝' },
];

export function AppearanceSettings() {
  const { theme, setTheme, palette, setPalette } = useTheme();
  return <div className="appearance-settings">
    <h3>主题设置</h3>
    <p>配色和明暗模式独立选择，自动保存在当前浏览器。</p>
    <span className="field-caption">配色风格</span>
    <div className="palette-options" role="group" aria-label="配色风格">
      {palettes.map(item => <button type="button" key={item.value} className={'palette-option ' + item.value + (palette === item.value ? ' selected' : '')} aria-pressed={palette === item.value} onClick={() => setPalette(item.value)}>
        <span className="palette-preview" aria-hidden="true"><i /><i /><i /></span>
        <span>{item.label}{palette === item.value && <Check size={12} />}</span>
      </button>)}
    </div>
    <span className="field-caption">明暗模式</span>
    <div className="segmented" role="group" aria-label="明暗模式">
      <button type="button" className={theme === 'light' ? 'selected' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={13} />浅色</button>
      <button type="button" className={theme === 'dark' ? 'selected' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={13} />深色</button>
      <button type="button" className={theme === 'system' ? 'selected' : ''} aria-pressed={theme === 'system'} onClick={() => setTheme('system')}><Monitor size={13} />跟随系统</button>
    </div>
  </div>;
}
