import { useCallback, useEffect, useState } from 'react';
import type { HostedImage } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: { verificationRequired?: boolean; email?: string }) { super(message); }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { body, ...rest } = options;
  const headers = new Headers(options.headers);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...rest, headers, credentials: 'same-origin',
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error || '服务暂时不可用，请稍后再试', response.status, result);
  return result as T;
}

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    api<T>(path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, refresh };
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
export function formatBytes(bytes: number, digits = 1) {
  if (bytes < 1024) return Math.max(0, bytes) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return Number(value.toFixed(digits)).toLocaleString('zh-CN') + ' ' + units[index];
}
export const formatDate = (date: string, time = false) => new Date(date).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
});
export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.append(input); input.select();
  const copied = document.execCommand('copy'); input.remove();
  if (!copied) throw new Error('复制失败，请手动选择并复制');
}

export type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode';
export function imageLink(image: HostedImage, format: LinkFormat) {
  if (format === 'markdown') return '![](' + image.url + ')';
  if (format === 'bbcode') return '[img]' + image.url + '[/img]';
  if (format === 'html') {
    const alt = image.name.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return '<img src="' + image.url + '" alt="' + alt + '" />';
  }
  return image.url;
}
