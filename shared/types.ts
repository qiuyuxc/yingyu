export const GiB = 1024 ** 3;
export const MiB = 1024 ** 2;
export type Role = 'user' | 'admin';
export type StorageKind = 'local' | 's3' | 'r2' | 'webdav';
export type ImageVisibility = 'public' | 'private';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'suspended';
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  imageCount: number;
  tier: string;
  createdAt: string;
}

export interface HostedImage {
  id: string;
  name: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  albumId: string | null;
  visibility: ImageVisibility;
  starred: boolean;
  storageId: string;
  storageName: string;
  createdAt: string;
  url: string;
  ownerName?: string;
  ownerId?: string;
}

export interface Album { id: string; name: string; count: number; createdAt: string }

export interface StorageConfig {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  password?: string;
  path?: string;
  forcePathStyle?: boolean;
}

export interface StorageProvider {
  id: string;
  name: string;
  kind: StorageKind;
  active: boolean;
  config: StorageConfig;
  hasSecrets: boolean;
  imageCount: number;
  usedBytes: number;
  createdAt: string;
}

export interface QuotaRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  currentQuota: number;
  requestedBytes: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  registrationOpen: boolean;
  defaultQuotaBytes: number;
  maxUploadBytes: number;
  announcement: string;
}

export interface SiteInfo {
  settings: SiteSettings;
  initialized: boolean;
  storageReady: boolean;
  email?: { passwordReset: boolean; verification: boolean };
}

export interface MailSettings {
  enabled: boolean;
  host: string;
  port: number;
  encryption: 'tls' | 'starttls' | 'none';
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  passwordReset: boolean;
  verification: boolean;
  quotaNotifications: boolean;
  reviewInbox: string;
}
export type PublicMailSettings = Omit<MailSettings, 'password'> & { hasPassword: boolean };
export interface MailLog { id: string; recipient: string; kind: string; status: 'sent' | 'failed'; error: string; createdAt: string }

export interface AuditEntry { id: number; actor: string; action: string; target: string; detail: string; createdAt: string }

export interface AdminOverview {
  users: number;
  images: number;
  usedBytes: number;
  quotaBytes: number;
  pendingRequests: number;
  uploadsToday: number;
  dailyUploads: { date: string; count: number; bytes: number }[];
  recentAudit: AuditEntry[];
}

export interface ApiToken { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }
