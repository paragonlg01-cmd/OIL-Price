import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock,
  LogOut,
  Mail,
  Plus,
  Send,
  Server,
  Trash2,
  AlertCircle,
  Eye,
  X,
  HelpCircle,
  Code2,
  Copy,
  Check,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  sendGmailMessage,
} from '../services/googleAuth';
import { PttLogoIcon } from './PttLogoIcon';

export interface DisplayRowItem {
  day: number;
  isoDate: string;
  dateFormatted: string;
  b10Price: number;
  b10Display: string;
  evDisplay: string;
  isRowPopulated: boolean;
}

interface EmailAlertManagerProps {
  year: number;
  month: number;
  todayThailand: string;
  effectiveText: string;
  latestB10Price: number;
  defaultEvPrice: string;
  customOverrides: Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>;
  displayRows: DisplayRowItem[];
  publicTunnelUrl?: string;
}

type AutoTriggerMode =
  | 'specific_dates'
  | 'specific_dates_and_change'
  | 'daily_time'
  | 'on_price_change';

interface SentEmailLog {
  id: string;
  sentAt: string;
  isoDateBangkok?: string;
  recipients: string[];
  subject: string;
  b10Price: number;
  triggerType: 'manual' | 'auto_scheduled_date' | 'auto_daily' | 'auto_price_change';
  channel?: 'server_smtp' | 'client_gmail';
}

const DEFAULT_RECIPIENT_LIST = [
  'Chawalit.M@pttgcgroup.com',
  'Ronpol.P@pttgcgroup.com',
  'Anuwat.K@pttgcgroup.com',
  'Prasit.Su@pttgcgroup.com',
  'Sirilak.S@pttgcgroup.com',
];

const getDeletedRecipients = (): Set<string> => {
  try {
    const raw = localStorage.getItem('ptt_b10_deleted_recipients_v1');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const set = new Set(arr.map((e) => String(e).toLowerCase().trim()));
        set.add('paragon.lg01@gmail.com');
        return set;
      }
    }
  } catch {}
  return new Set(['paragon.lg01@gmail.com']);
};

const markRecipientDeletedLocally = (email: string) => {
  try {
    const set = getDeletedRecipients();
    set.add(email.toLowerCase().trim());
    localStorage.setItem('ptt_b10_deleted_recipients_v1', JSON.stringify(Array.from(set)));
  } catch {}
};

export const EmailAlertManager: React.FC<EmailAlertManagerProps> = ({
  year,
  month,
  todayThailand,
  effectiveText,
  latestB10Price,
  defaultEvPrice,
  customOverrides,
  displayRows,
  publicTunnelUrl,
}) => {
  // Server-side Cron + SMTP status
  const [smtpConfigured, setSmtpConfigured] = useState<boolean>(false);
  const [smtpUser, setSmtpUser] = useState<string>('');
  const [serverLoaded, setServerLoaded] = useState<boolean>(false);
  const [showSmtpGuide, setShowSmtpGuide] = useState<boolean>(false);
  const [showAppsScriptModal, setShowAppsScriptModal] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);

  // Google Workspace Auth state (fallback / instant browser send)
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Schedule & Recipient State (permanently synced between Server-Side Cron store & localStorage)
  const [recipients, setRecipients] = useState<string[]>(() => {
    const deleted = getDeletedRecipients();
    try {
      const saved = localStorage.getItem('ptt_b10_email_recipients_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((e) => !deleted.has(String(e).toLowerCase().trim()));
          if (filtered.length > 0) return filtered;
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_RECIPIENT_LIST.filter((e) => !deleted.has(e.toLowerCase().trim()));
  });
  const [newEmailInput, setNewEmailInput] = useState<string>('');
  const [emailInputError, setEmailInputError] = useState<string | null>(null);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);

  const loadLocalScheduleConfig = () => {
    try {
      const raw = localStorage.getItem('ptt_b10_schedule_settings_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as {
            autoEnabled?: boolean;
            triggerMode?: AutoTriggerMode;
            scheduledDays?: number[];
            includeEndOfMonth?: boolean;
            scheduledTime?: string;
            customSubject?: string;
            updatedAt?: number;
            pendingSync?: boolean;
            userModified?: boolean;
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  const initialLocalCfg = useMemo(() => loadLocalScheduleConfig(), []);

  const [autoEnabled, setAutoEnabled] = useState<boolean>(() =>
    typeof initialLocalCfg?.autoEnabled === 'boolean' ? initialLocalCfg.autoEnabled : true
  );
  const [triggerMode, setTriggerMode] = useState<AutoTriggerMode>(() =>
    typeof initialLocalCfg?.triggerMode === 'string'
      ? initialLocalCfg.triggerMode
      : 'specific_dates'
  );
  const [scheduledDays, setScheduledDays] = useState<number[]>(() =>
    Array.isArray(initialLocalCfg?.scheduledDays) ? initialLocalCfg.scheduledDays : [22, 23, 24]
  );
  const [includeEndOfMonth, setIncludeEndOfMonth] = useState<boolean>(() =>
    typeof initialLocalCfg?.includeEndOfMonth === 'boolean'
      ? initialLocalCfg.includeEndOfMonth
      : false
  );
  const [showDayPickerGrid, setShowDayPickerGrid] = useState<boolean>(true);
  const [scheduledTime, setScheduledTime] = useState<string>(() =>
    typeof initialLocalCfg?.scheduledTime === 'string' ? initialLocalCfg.scheduledTime : '08:00'
  );
  const [customSubject, setCustomSubject] = useState<string>(() =>
    typeof initialLocalCfg?.customSubject === 'string' && initialLocalCfg.customSubject
      ? initialLocalCfg.customSubject
      : 'อัปเดตราคาน้ำมันดีเซล B10 และ EV Price ประจำวันที่ {today}'
  );
  const [sentLogs, setSentLogs] = useState<SentEmailLog[]>([]);
  const [scheduleSavedFlash, setScheduleSavedFlash] = useState<boolean>(false);

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    triggerType: 'manual' | 'auto_scheduled_date' | 'auto_daily' | 'auto_price_change';
    reasonText: string;
  } | null>(null);

  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendFeedback, setSendFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const isInitialHydrating = useRef<boolean>(true);
  const inFlightSaveCountRef = useRef<number>(0);
  const scheduleConfigRef = useRef<{
    autoEnabled: boolean;
    triggerMode: AutoTriggerMode;
    scheduledDays: number[];
    includeEndOfMonth: boolean;
    scheduledTime: string;
    customSubject: string;
    updatedAt: number;
    pendingSync: boolean;
    userModified: boolean;
  }>({
    autoEnabled:
      typeof initialLocalCfg?.autoEnabled === 'boolean' ? initialLocalCfg.autoEnabled : true,
    triggerMode:
      typeof initialLocalCfg?.triggerMode === 'string'
        ? initialLocalCfg.triggerMode
        : 'specific_dates',
    scheduledDays: Array.isArray(initialLocalCfg?.scheduledDays)
      ? initialLocalCfg.scheduledDays
      : [22, 23, 24],
    includeEndOfMonth:
      typeof initialLocalCfg?.includeEndOfMonth === 'boolean'
        ? initialLocalCfg.includeEndOfMonth
        : false,
    scheduledTime:
      typeof initialLocalCfg?.scheduledTime === 'string' ? initialLocalCfg.scheduledTime : '08:00',
    customSubject:
      typeof initialLocalCfg?.customSubject === 'string' && initialLocalCfg.customSubject
        ? initialLocalCfg.customSubject
        : 'อัปเดตราคาน้ำมันดีเซล B10 และ EV Price ประจำวันที่ {today}',
    updatedAt: initialLocalCfg?.updatedAt || 0,
    pendingSync: Boolean(initialLocalCfg?.pendingSync),
    userModified: Boolean(initialLocalCfg?.userModified),
  });

  const sharedPublicOrigin = useMemo(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (origin.includes('.trycloudflare.com')) {
        return origin;
      }
    }
    if (publicTunnelUrl && publicTunnelUrl.startsWith('https://')) {
      return publicTunnelUrl;
    }
    return 'https://grant-courtesy-authentic-critical.trycloudflare.com';
  }, [publicTunnelUrl]);

  const saveRecipientsLocally = (list: string[]) => {
    try {
      localStorage.setItem('ptt_b10_email_recipients_v1', JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const saveScheduleConfigLocally = useCallback(
    (cfg: {
      autoEnabled: boolean;
      triggerMode: AutoTriggerMode;
      scheduledDays: number[];
      includeEndOfMonth: boolean;
      scheduledTime: string;
      customSubject: string;
      updatedAt: number;
      pendingSync?: boolean;
      userModified?: boolean;
    }) => {
      try {
        localStorage.setItem('ptt_b10_schedule_settings_v2', JSON.stringify(cfg));
      } catch {
        // ignore
      }
    },
    []
  );

  const pushScheduleConfigToServer = useCallback(
    async (
      payload: {
        autoEnabled: boolean;
        triggerMode: AutoTriggerMode;
        scheduledDays: number[];
        includeEndOfMonth: boolean;
        scheduledTime: string;
        customSubject: string;
        updatedAt: number;
        pendingSync?: boolean;
        userModified?: boolean;
      },
      isInitialRestore = false
    ) => {
      inFlightSaveCountRef.current += 1;
      try {
        const res = await fetch('/api/schedule-config', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            defaultEvPrice,
            isInitialRestore,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const serverTs =
            typeof data?.config?.updatedAt === 'number' && data.config.updatedAt > 0
              ? data.config.updatedAt
              : payload.updatedAt;
          if (inFlightSaveCountRef.current <= 1) {
            const syncedCfg = {
              ...scheduleConfigRef.current,
              updatedAt: serverTs,
              pendingSync: false,
            };
            scheduleConfigRef.current = syncedCfg;
            saveScheduleConfigLocally(syncedCfg);
          }
        }
      } catch {
        // Keep pendingSync: true in localStorage so it retries on next connection
      } finally {
        inFlightSaveCountRef.current = Math.max(0, inFlightSaveCountRef.current - 1);
      }
    },
    [defaultEvPrice, saveScheduleConfigLocally]
  );

  const persistScheduleChange = useCallback(
    (
      partial: Partial<{
        autoEnabled: boolean;
        triggerMode: AutoTriggerMode;
        scheduledDays: number[];
        includeEndOfMonth: boolean;
        scheduledTime: string;
        customSubject: string;
      }>
    ) => {
      const current = scheduleConfigRef.current;
      const nowTs = Math.max(Date.now(), (current.updatedAt || 0) + 1);

      const nextCfg = {
        autoEnabled: partial.autoEnabled !== undefined ? partial.autoEnabled : current.autoEnabled,
        triggerMode: partial.triggerMode !== undefined ? partial.triggerMode : current.triggerMode,
        scheduledDays:
          partial.scheduledDays !== undefined ? partial.scheduledDays : current.scheduledDays,
        includeEndOfMonth:
          partial.includeEndOfMonth !== undefined
            ? partial.includeEndOfMonth
            : current.includeEndOfMonth,
        scheduledTime:
          partial.scheduledTime !== undefined ? partial.scheduledTime : current.scheduledTime,
        customSubject:
          partial.customSubject !== undefined ? partial.customSubject : current.customSubject,
        updatedAt: nowTs,
        pendingSync: true,
        userModified: true,
      };

      scheduleConfigRef.current = nextCfg;

      if (partial.autoEnabled !== undefined) setAutoEnabled(partial.autoEnabled);
      if (partial.triggerMode !== undefined) setTriggerMode(partial.triggerMode);
      if (partial.scheduledDays !== undefined) setScheduledDays(partial.scheduledDays);
      if (partial.includeEndOfMonth !== undefined) setIncludeEndOfMonth(partial.includeEndOfMonth);
      if (partial.scheduledTime !== undefined) setScheduledTime(partial.scheduledTime);
      if (partial.customSubject !== undefined) setCustomSubject(partial.customSubject);

      saveScheduleConfigLocally(nextCfg);
      pushScheduleConfigToServer(nextCfg, false);

      setScheduleSavedFlash(true);
      setTimeout(() => setScheduleSavedFlash(false), 2500);
    },
    [saveScheduleConfigLocally, pushScheduleConfigToServer]
  );

  // Flush any pending schedule changes if the user closes or refreshes the browser immediately
  useEffect(() => {
    const handleUnload = () => {
      const current = scheduleConfigRef.current;
      if (current.pendingSync && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify({ ...current, defaultEvPrice })], {
            type: 'application/json',
          });
          navigator.sendBeacon('/api/schedule-config', blob);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [defaultEvPrice]);

  const applyIncomingServerConfig = useCallback(
    (cfg: any, smtpOk?: boolean, smtpUsr?: string) => {
      if (!cfg) return;

      if (typeof smtpOk === 'boolean') setSmtpConfigured(smtpOk);
      if (typeof smtpUsr === 'string') setSmtpUser(smtpUsr);
      if (Array.isArray(cfg.sentLogs)) {
        setSentLogs(cfg.sentLogs);
      }

      const serverUpdatedAt = typeof cfg.updatedAt === 'number' ? cfg.updatedAt : 0;

      if (isInitialHydrating.current) {
        isInitialHydrating.current = false;

        // 1. Clean recipients (never re-add deleted emails like paragon.lg01@gmail.com)
        const deleted = getDeletedRecipients();
        let localList: string[] = [];
        try {
          const rawLocal = localStorage.getItem('ptt_b10_email_recipients_v1');
          if (rawLocal) {
            const parsed = JSON.parse(rawLocal);
            if (Array.isArray(parsed)) localList = parsed;
          }
        } catch {
          // ignore
        }
        const serverList: string[] = Array.isArray(cfg.recipients)
          ? cfg.recipients
          : DEFAULT_RECIPIENT_LIST;

        const seen = new Set<string>();
        const merged: string[] = [];
        for (const item of [...serverList, ...localList]) {
          const clean = String(item || '').trim();
          if (clean && !deleted.has(clean.toLowerCase()) && !seen.has(clean.toLowerCase())) {
            seen.add(clean.toLowerCase());
            merged.push(clean);
          }
        }

        const finalRecipients =
          merged.length > 0
            ? merged
            : DEFAULT_RECIPIENT_LIST.filter((e) => !deleted.has(e.toLowerCase().trim()));

        setRecipients(finalRecipients);
        saveRecipientsLocally(finalRecipients);

        if (merged.length > serverList.length) {
          fetch('/api/recipients/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: finalRecipients }),
          }).catch(() => {});
        }

        // 2. Compare local saved schedule settings vs server schedule settings
        const localSaved = loadLocalScheduleConfig();
        const localUpdatedAt = localSaved?.updatedAt || 0;
        const shouldRestoreLocalToServer =
          localSaved &&
          (localSaved.pendingSync === true ||
            (localSaved.userModified === true &&
              (serverUpdatedAt === 0 || localUpdatedAt >= serverUpdatedAt)) ||
            localUpdatedAt > serverUpdatedAt);

        if (shouldRestoreLocalToServer && localSaved) {
          const restoredCfg = {
            autoEnabled:
              typeof localSaved.autoEnabled === 'boolean' ? localSaved.autoEnabled : true,
            triggerMode:
              typeof localSaved.triggerMode === 'string'
                ? localSaved.triggerMode
                : ('specific_dates' as AutoTriggerMode),
            scheduledDays: Array.isArray(localSaved.scheduledDays)
              ? localSaved.scheduledDays
              : [22, 23, 24],
            includeEndOfMonth:
              typeof localSaved.includeEndOfMonth === 'boolean'
                ? localSaved.includeEndOfMonth
                : false,
            scheduledTime:
              typeof localSaved.scheduledTime === 'string' ? localSaved.scheduledTime : '08:00',
            customSubject:
              typeof localSaved.customSubject === 'string' && localSaved.customSubject
                ? localSaved.customSubject
                : 'อัปเดตราคาน้ำมันดีเซล B10 และ EV Price ประจำวันที่ {today}',
            updatedAt: Math.max(localUpdatedAt, Date.now()),
            pendingSync: false,
            userModified: true,
          };
          scheduleConfigRef.current = restoredCfg;
          setAutoEnabled(restoredCfg.autoEnabled);
          setTriggerMode(restoredCfg.triggerMode);
          setScheduledDays(restoredCfg.scheduledDays);
          setIncludeEndOfMonth(restoredCfg.includeEndOfMonth);
          setScheduledTime(restoredCfg.scheduledTime);
          setCustomSubject(restoredCfg.customSubject);
          saveScheduleConfigLocally(restoredCfg);
          pushScheduleConfigToServer(restoredCfg, false);
          setServerLoaded(true);
          return;
        }
      } else {
        if (Array.isArray(cfg.recipients)) {
          const deleted = getDeletedRecipients();
          const clean = cfg.recipients
            .map((e: string) => String(e || '').trim())
            .filter((e: string) => e && !deleted.has(e.toLowerCase()));
          setRecipients(clean);
          saveRecipientsLocally(clean);
        }
        // Never overwrite while a user save is in flight or if the user modified locally more recently
        if (
          inFlightSaveCountRef.current > 0 ||
          scheduleConfigRef.current.pendingSync ||
          (serverUpdatedAt > 0 && serverUpdatedAt < scheduleConfigRef.current.updatedAt) ||
          (serverUpdatedAt === 0 && scheduleConfigRef.current.userModified)
        ) {
          return;
        }
      }

      const current = scheduleConfigRef.current;
      const resolvedAutoEnabled =
        typeof cfg.autoEnabled === 'boolean' ? cfg.autoEnabled : current.autoEnabled;
      const resolvedTriggerMode =
        typeof cfg.triggerMode === 'string' ? cfg.triggerMode : current.triggerMode;
      const resolvedScheduledDays = Array.isArray(cfg.scheduledDays)
        ? cfg.scheduledDays
        : current.scheduledDays;
      const resolvedIncludeEndOfMonth =
        typeof cfg.includeEndOfMonth === 'boolean'
          ? cfg.includeEndOfMonth
          : current.includeEndOfMonth;
      const resolvedScheduledTime =
        typeof cfg.scheduledTime === 'string' ? cfg.scheduledTime : current.scheduledTime;
      const resolvedSubject =
        typeof cfg.customSubject === 'string' &&
        cfg.customSubject &&
        cfg.customSubject !==
          'อัปเดตราคาน้ำมันดีเซล B10 (Fuel price B10 PTT) ประจำวันที่ {today} — {price} บาท/ลิตร'
          ? cfg.customSubject
          : 'อัปเดตราคาน้ำมันดีเซล B10 และ EV Price ประจำวันที่ {today}';

      setAutoEnabled(resolvedAutoEnabled);
      setTriggerMode(resolvedTriggerMode);
      setScheduledDays(resolvedScheduledDays);
      setIncludeEndOfMonth(resolvedIncludeEndOfMonth);
      setScheduledTime(resolvedScheduledTime);
      setCustomSubject(resolvedSubject);

      const nextSynced = {
        autoEnabled: resolvedAutoEnabled,
        triggerMode: resolvedTriggerMode,
        scheduledDays: resolvedScheduledDays,
        includeEndOfMonth: resolvedIncludeEndOfMonth,
        scheduledTime: resolvedScheduledTime,
        customSubject: resolvedSubject,
        updatedAt: serverUpdatedAt,
        pendingSync: false,
        userModified: current.userModified,
      };
      scheduleConfigRef.current = nextSynced;
      saveScheduleConfigLocally(nextSynced);

      setServerLoaded(true);
    },
    [saveScheduleConfigLocally, pushScheduleConfigToServer]
  );

  // 1. Load initial Server-Side Schedule Configuration & merge recipients permanently
  const fetchServerConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule-config');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.config) {
        applyIncomingServerConfig(data.config, Boolean(data.smtpConfigured), data.smtpUser || '');
      }
    } catch {
      // ignore network error during poll
    }
  }, [applyIncomingServerConfig]);

  useEffect(() => {
    fetchServerConfig();
    const pollTimer = setInterval(fetchServerConfig, 20000);
    return () => clearInterval(pollTimer);
  }, [fetchServerConfig]);

  // 1b. Subscribe to Real-Time SSE stream (/api/realtime-stream) so changes on any device sync immediately
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/realtime-stream');
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'state:sync' && payload.config) {
            applyIncomingServerConfig(
              payload.config,
              Boolean(payload.smtpConfigured),
              payload.smtpUser || ''
            );
          }
        } catch {
          // ignore parse error
        }
      };
    } catch {
      // ignore if EventSource fails
    }
    return () => {
      if (es) es.close();
    };
  }, [applyIncomingServerConfig]);

  // Initialize Firebase Auth listener for optional browser Gmail OAuth
  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const lastDayOfSelectedMonth = useMemo(() => {
    return new Date(year, month, 0).getDate();
  }, [year, month]);

  const resolvedMonthDays = useMemo(() => {
    const validDays = scheduledDays.filter((d) => d >= 1 && d <= lastDayOfSelectedMonth);
    if (includeEndOfMonth) {
      validDays.push(lastDayOfSelectedMonth);
    }
    return Array.from(new Set(validDays)).sort((a, b) => a - b);
  }, [scheduledDays, includeEndOfMonth, lastDayOfSelectedMonth]);

  const toggleDaySelection = (dayNum: number) => {
    const currentDays = scheduleConfigRef.current.scheduledDays;
    const nextDays = currentDays.includes(dayNum)
      ? currentDays.filter((d) => d !== dayNum)
      : [...currentDays, dayNum].sort((a, b) => a - b);
    persistScheduleChange({ scheduledDays: nextDays });
  };

  const applyPresetDays = (days: number[], endOfMonth: boolean) => {
    persistScheduleChange({ scheduledDays: days, includeEndOfMonth: endOfMonth });
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setSendFeedback(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      setSendFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
  };

  const handleAddRecipient = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setEmailInputError(null);

    const candidates = newEmailInput
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (candidates.length === 0) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = candidates.filter((c) => !emailRegex.test(c));
    if (invalid.length > 0) {
      setEmailInputError(`รูปแบบอีเมลไม่ถูกต้อง: ${invalid.join(', ')}`);
      return;
    }

    const existingLower = new Set(recipients.map((r) => r.toLowerCase()));
    const updated = [...recipients];
    for (const c of candidates) {
      if (!existingLower.has(c.toLowerCase())) {
        updated.push(c);
        existingLower.add(c.toLowerCase());
      }
    }

    setRecipients(updated);
    saveRecipientsLocally(updated);
    setNewEmailInput('');

    try {
      const res = await fetch('/api/recipients/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: candidates }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.recipients)) {
        setRecipients(data.recipients);
        saveRecipientsLocally(data.recipients);
      }
    } catch {
      // already saved locally
    }
  };

  const handleConfirmRemoveRecipient = async (emailToRemove: string) => {
    const cleanRemove = emailToRemove.toLowerCase().trim();
    markRecipientDeletedLocally(cleanRemove);

    const updated = recipients.filter(
      (item) => item.toLowerCase().trim() !== cleanRemove
    );
    setRecipients(updated);
    saveRecipientsLocally(updated);
    setConfirmDeleteEmail(null);

    try {
      const res = await fetch('/api/recipients/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanRemove }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.recipients)) {
        const deleted = getDeletedRecipients();
        const cleanList = data.recipients
          .map((e: string) => String(e || '').trim())
          .filter((e: string) => e && !deleted.has(e.toLowerCase()));
        setRecipients(cleanList);
        saveRecipientsLocally(cleanList);
      }
    } catch {
      // already updated locally
    }
  };

  const formattedTodayThai = useMemo(() => {
    if (!todayThailand) return '';
    const [y, m, d] = todayThailand.split('-');
    return `${d}/${m}/${y}`;
  }, [todayThailand]);

  const resolvedSubject = useMemo(() => {
    return customSubject
      .replace('{today}', formattedTodayThai || `${String(month).padStart(2, '0')}/${year}`)
      .replace('{price}', latestB10Price ? latestB10Price.toFixed(2) : '')
      .replace('{month}', String(month).padStart(2, '0'))
      .replace('{year}', String(year));
  }, [customSubject, formattedTodayThai, latestB10Price, month, year]);

  const buildFormattedEmailHtml = useCallback(() => {
    const rowsHtml = displayRows
      .map(
        (r) => `
        <tr style="height: 28px; background-color: #FFFFFF;">
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #000000; padding: 3px 8px;">${r.dateFormatted}</td>
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">${r.b10Display}</td>
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">${r.evDisplay}</td>
        </tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 16px; background-color: #FFFFFF; font-family: Calibri, Arial, sans-serif; color: #0F172A;">
  <div style="margin-bottom: 12px; font-size: 14px; color: #1E293B;">
    <strong>รายงานอัปเดตราคาน้ำมันดีเซล B10 (Fuel price B10 PTT) และ EV price</strong><br/>
    <span style="font-size: 12px; color: #475569;">ข้อมูลอ้างอิงจาก: <a href="http://www.pttor.com/oilprice-board.aspx" style="color: #1D3C85;">http://www.pttor.com/oilprice-board.aspx</a> (${effectiveText || 'ล่าสุด'})</span>
  </div>

  <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #000000; width: 440px; background-color: #FFFFFF;">
    <thead>
      <tr style="height: 44px; background-color: #FFFF99;">
        <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-family: Calibri, Arial, sans-serif; font-size: 15px; font-weight: bold; text-align: center; width: 120px; padding: 6px 8px;">
          Date
        </th>
        <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-family: Calibri, Arial, sans-serif; font-size: 15px; font-weight: bold; text-align: center; width: 205px; padding: 0; vertical-align: middle;">
          <div style="position: relative; width: 100%; height: 44px; display: block;">
            <div style="float: right; width: 0; height: 0; border-left: 7px solid transparent; border-top: 7px solid #FF0000;"></div>
            <div style="padding: 10px 8px 6px 8px; text-align: center;">
              <span style="display: inline-block; width: 14px; height: 18px; background-color: #FFFFFF; border-radius: 2px; vertical-align: middle; margin-right: 4px; text-align: center; line-height: 18px;">
                <span style="display: inline-block; width: 10px; height: 13px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; background: radial-gradient(circle at 50% 65%, #ED1C24 28%, #00AEEF 55%, #1D3C85 100%);"></span>
              </span>
              <span style="vertical-align: middle; color: #0000FF; font-weight: bold;">Fuel price B10 PTT</span>
            </div>
          </div>
        </th>
        <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-family: Calibri, Arial, sans-serif; font-size: 15px; font-weight: bold; text-align: center; width: 115px; padding: 6px 8px;">
          EV price
        </th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
  }, [displayRows, effectiveText]);

  const sentTodayLog = useMemo(() => {
    if (!todayThailand) return null;
    return sentLogs.find((log) => log.isoDateBangkok === todayThailand) || null;
  }, [sentLogs, todayThailand]);

  const sentTodayTimeText = useMemo(() => {
    if (!sentTodayLog?.sentAt) return '';
    try {
      return new Date(sentTodayLog.sentAt).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return '';
    }
  }, [sentTodayLog]);

  const handleRequestSendNow = async () => {
    setSendFeedback(null);

    if (sentTodayLog) {
      setSendFeedback({
        type: 'error',
        message: `ระบบป้องกันการส่งซ้ำ: วันนี้ (${formattedTodayThai}) มีการส่งอีเมลแจ้งเตือนไปแล้วเมื่อเวลา ${sentTodayTimeText} น. ระบบจึงล็อกไม่ให้ส่งซ้ำอีกในวันนี้`,
      });
      return;
    }

    if (recipients.length === 0) {
      setSendFeedback({
        type: 'error',
        message: 'กรุณาเพิ่มอีเมลผู้เกี่ยวข้องอย่างน้อย 1 รายการก่อนส่ง',
      });
      return;
    }

    const token = await getAccessToken();
    if (!smtpConfigured && !token) {
      setShowSmtpGuide(true);
      setSendFeedback({
        type: 'error',
        message:
          'กรุณาตั้งค่า SMTP_USER และ SMTP_PASS (Gmail App Password) ใน Secrets หรือคลิก Sign in with Google เพื่อทดสอบส่งทันที',
      });
      return;
    }

    setConfirmModal({
      open: true,
      triggerType: 'manual',
      reasonText: smtpConfigured
        ? 'ยืนยันการสั่งส่งอีเมลผ่าน Server-Side SMTP ไปยังอีเมลผู้เกี่ยวข้อง (ส่งได้วันละ 1 ครั้ง)'
        : 'ยืนยันการส่งตารางราคาน้ำมันดีเซล B10 ไปยังอีเมลผู้เกี่ยวข้อง (ส่งได้วันละ 1 ครั้ง)',
    });
  };

  const executeConfirmedSend = async () => {
    if (!confirmModal) return;
    if (sentTodayLog) {
      setConfirmModal(null);
      setSendFeedback({
        type: 'error',
        message: `ระบบป้องกันการส่งซ้ำ: วันนี้ (${formattedTodayThai}) มีการส่งอีเมลแจ้งเตือนไปแล้วเมื่อเวลา ${sentTodayTimeText} น.`,
      });
      return;
    }
    setIsSending(true);
    setSendFeedback(null);

    try {
      // Prefer Server-Side SMTP if configured
      if (smtpConfigured) {
        const res = await fetch('/api/send-server-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, month }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'ส่งอีเมลผ่าน Server SMTP ไม่สำเร็จ');
        }
        if (data.config?.sentLogs) {
          setSentLogs(data.config.sentLogs);
        }
        setConfirmModal(null);
        setSendFeedback({
          type: 'success',
          message: `ส่งอีเมลจาก Server SMTP สำเร็จไปยังผู้รับ ${recipients.length} รายการ`,
        });
        return;
      }

      // Fallback: Client-Side Google OAuth (Gmail API)
      const htmlBody = buildFormattedEmailHtml();
      const result = await sendGmailMessage({
        to: recipients,
        subject: resolvedSubject,
        htmlBody,
      });

      const newLog: SentEmailLog = {
        id: result.id || String(Date.now()),
        sentAt: new Date().toISOString(),
        isoDateBangkok: todayThailand,
        recipients: [...recipients],
        subject: resolvedSubject,
        b10Price: latestB10Price,
        triggerType: confirmModal.triggerType,
        channel: 'client_gmail',
      };

      const updatedLogs = [newLog, ...sentLogs].slice(0, 25);
      setSentLogs(updatedLogs);
      await fetch('/api/schedule-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentLogs: updatedLogs }),
      }).catch(() => {});

      setConfirmModal(null);
      setSendFeedback({
        type: 'success',
        message: `ส่งอีเมลแจ้งเตือนสำเร็จไปยังผู้รับ ${recipients.length} รายการ (Message ID: ${result.id})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งอีเมล';
      setSendFeedback({
        type: 'error',
        message: msg,
      });
      setConfirmModal(null);
    } finally {
      setIsSending(false);
    }
  };

  const monthStr = String(month).padStart(2, '0');

  return (
    <section
      id="email-alerts"
      className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4"
    >
      {/* Header & Server Cron / SMTP Status */}
      <div className="flex flex-col gap-3 pb-3.5 border-b border-slate-100">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#1D3C85]/10 text-[#1D3C85] flex items-center justify-center shrink-0 mt-0.5">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
              ระบบส่งอีเมลอัตโนมัติ (Server-Side Cron + SMTP)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              ทำงานอัตโนมัติบนเซิร์ฟเวอร์ตามวันที่ระบุ (เช่น 01, 10, 20, สิ้นเดือน) แม้ปิดหน้าเว็บหรือปิดคอมพิวเตอร์
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAppsScriptModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1D3C85] bg-blue-50 hover:bg-blue-100 border border-blue-200/80 rounded-lg transition-colors cursor-pointer"
          >
            <Code2 className="w-3.5 h-3.5 text-[#1D3C85] shrink-0" />
            <span>โค้ด Google Apps Script (กันระบบหลับ 100%)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSmtpGuide((v) => !v)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-lg transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#1D3C85] shrink-0" />
            <span>{showSmtpGuide ? 'ซ่อนวิธีตั้งค่า SMTP' : 'วิธีตั้งค่า SMTP'}</span>
          </button>
        </div>
      </div>

      {/* Server SMTP Connection Status Box */}
      <div
        className={`p-3.5 rounded-lg border text-xs flex flex-col gap-2 ${
          smtpConfigured
            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            : 'bg-amber-50/80 border-amber-200 text-amber-950'
        }`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold">
            {smtpConfigured ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Server Cron + SMTP พร้อมทำงานอัตโนมัติ 24 ชม. ({smtpUser})</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>รอการตั้งค่า SMTP_USER และ SMTP_PASS ในแถบ Secrets ของระบบ</span>
              </>
            )}
          </div>

          {smtpConfigured ? (
            <div className="flex items-center">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-100/90 text-emerald-800 border border-emerald-300/80">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse shrink-0" />
                <span>เชื่อมต่อถาวรผ่าน Server SMTP (ไม่หลุดเมื่อปิดหน้าเว็บ)</span>
              </span>
            </div>
          ) : (
            /* Optional Browser Sign-In fallback only when Server SMTP is not configured */
            <div className="shrink-0">
              {needsAuth || !user ? (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  className="gsi-material-button"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: 'block' }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn ? 'กำลังเชื่อมต่อ...' : 'Sign in with Google'}
                    </span>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-2.5 py-1">
                  <span className="text-xs text-slate-700 font-medium truncate max-w-[160px]">
                    {user.email}
                  </span>
                  <button
                    type="button"
                    onClick={handleGoogleLogout}
                    title="ออกจากระบบ Google"
                    className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {(!smtpConfigured || showSmtpGuide) && (
          <div className="pt-2 border-t border-amber-200/70 text-xs text-slate-700 space-y-1">
            <div className="font-semibold text-slate-900">
              ขั้นตอนการเปิดใช้งานส่งอัตโนมัติจาก Server แม้ปิดคอมพิวเตอร์ (Gmail App Password):
            </div>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-600">
              <li>
                สร้าง <strong>รหัสผ่านสำหรับแอป (App Password 16 หลัก)</strong> ที่บัญชี Google ของผู้ส่ง (ในเมนู Security &rarr; 2-Step Verification &rarr; App passwords)
              </li>
              <li>
                เปิดแถบ <strong>Secrets</strong> ของแอปนี้ แล้วเพิ่มตัวแปร{' '}
                <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
                  SMTP_USER
                </code>{' '}
                (อีเมลผู้ส่ง เช่น <code className="font-mono">paragon.lg01@gmail.com</code>) และ{' '}
                <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
                  SMTP_PASS
                </code>{' '}
                (รหัสผ่าน App Password 16 หลัก)
              </li>
              <li>
                เมื่อตั้งค่าแล้ว เซิร์ฟเวอร์จะดึงราคาน้ำมัน B10 จาก{' '}
                <code className="font-mono">http://www.pttor.com/oilprice-board.aspx</code>{' '}
                และส่งอีเมลตารางออกเองตามวันที่และเวลาที่กำหนดโดยอัตโนมัติ
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Feedback Banner */}
      {sendFeedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-2 ${
            sendFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {sendFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{sendFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSendFeedback(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Recipient List (เมลผู้เกี่ยวข้อง) */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          รายชื่ออีเมลผู้เกี่ยวข้อง (บันทึกไว้บน Server สำหรับส่งอัตโนมัติ)
        </label>
        <form onSubmit={handleAddRecipient} className="flex items-center gap-2">
          <input
            type="text"
            value={newEmailInput}
            onChange={(e) => setNewEmailInput(e.target.value)}
            placeholder="ระบุอีเมล เช่น user@company.com (คั่นด้วย , ได้)"
            className="flex-1 px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>เพิ่มอีเมล</span>
          </button>
        </form>
        {emailInputError && <p className="mt-1 text-xs text-red-600">{emailInputError}</p>}

        {/* Recipient List Items (Permanent until explicitly deleted) */}
        <div className="mt-2.5 divide-y divide-slate-100 border border-slate-200 rounded-lg bg-slate-50/50 max-h-[160px] overflow-y-auto">
          {recipients.length === 0 ? (
            <div className="py-3 px-3 text-xs text-slate-400 text-center">
              ยังไม่มีรายชื่ออีเมลผู้รับ กรุณาเพิ่มอีเมลด้านบน
            </div>
          ) : (
            recipients.map((email) => {
              const isConfirmingDelete = confirmDeleteEmail === email;
              return (
                <div
                  key={email}
                  className="flex items-center justify-between px-3 py-2 text-xs text-slate-700 gap-2"
                >
                  <span className="font-mono truncate">{email}</span>
                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleConfirmRemoveRecipient(email)}
                        className="px-2 py-0.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer whitespace-nowrap"
                      >
                        ยืนยันลบ
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEmail(null)}
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-200 hover:bg-slate-300 rounded cursor-pointer whitespace-nowrap"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteEmail(email)}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer shrink-0"
                      title="คลิกเพื่อลบอีเมลนี้ออกจากระบบ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="text-[11px]">ลบ</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. Automated Schedule Configuration */}
      <div className="pt-2 border-t border-slate-100 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => persistScheduleChange({ autoEnabled: e.target.checked })}
              className="rounded border-slate-300 text-[#1D3C85] focus:ring-[#1D3C85]"
            />
            <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-[#1D3C85]" />
              เปิดใช้งานการส่งอัตโนมัติบนเซิร์ฟเวอร์ (Server Cron)
            </span>
          </label>
          {scheduleSavedFlash && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              <Check className="w-3 h-3 text-emerald-600" />
              บันทึกการตั้งค่าวันส่งเรียบร้อยแล้ว
            </span>
          )}
        </div>

        {autoEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="sm:col-span-7">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                รูปแบบการตั้งเวลาส่ง
              </label>
              <select
                value={triggerMode}
                onChange={(e) =>
                  persistScheduleChange({ triggerMode: e.target.value as AutoTriggerMode })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
              >
                <option value="specific_dates">
                  ส่งตามวันที่ระบุของเดือน (เช่น 01, 10, 20, สิ้นเดือน)
                </option>
                <option value="specific_dates_and_change">
                  ส่งตามวันที่ระบุของเดือน + เมื่อมีการปรับราคาใหม่
                </option>
                <option value="daily_time">ส่งประจำทุกวันตามเวลาที่กำหนด</option>
                <option value="on_price_change">ส่งเฉพาะวันที่มีการปรับราคา B10</option>
              </select>
            </div>

            <div className="sm:col-span-5">
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>เวลาที่ Server ส่งออก (น.)</span>
              </label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => persistScheduleChange({ scheduledTime: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
              />
            </div>

            {/* Specific Dates of Month Configuration */}
            {(triggerMode === 'specific_dates' ||
              triggerMode === 'specific_dates_and_change') && (
              <div className="sm:col-span-12 bg-white p-3 rounded-lg border border-slate-200 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <CalendarDays className="w-3.5 h-3.5 text-[#1D3C85]" />
                    <span>วันที่ส่งในแต่ละเดือน (บันทึกถาวรอัตโนมัติ)</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyPresetDays([], false)}
                      className="px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200/80 rounded transition-colors cursor-pointer whitespace-nowrap"
                    >
                      ล้างวันที่เลือก
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetDays([1, 10, 20], true)}
                      className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer whitespace-nowrap"
                    >
                      ค่าเริ่มต้น (01, 10, 20, สิ้นเดือน)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDayPickerGrid((v) => !v)}
                      className="px-2 py-1 text-[11px] font-semibold text-[#1D3C85] bg-blue-50 hover:bg-blue-100 rounded transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {showDayPickerGrid ? 'ซ่อนตาราง (01-31)' : 'เลือกวันที่ (01-31)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => persistScheduleChange({})}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3 h-3" />
                      <span>บันทึกวันส่ง</span>
                    </button>
                  </div>
                </div>

                {/* Quick toggle buttons for standard days + any custom selected days + End of Month */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from(new Set([...[1, 5, 10, 15, 20, 25], ...scheduledDays]))
                    .sort((a, b) => a - b)
                    .map((dayNum) => {
                      const isSelected = scheduledDays.includes(dayNum);
                      return (
                        <button
                          key={dayNum}
                          type="button"
                          onClick={() => toggleDaySelection(dayNum)}
                          className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'bg-[#1D3C85] text-white border-[#1D3C85] font-semibold shadow-xs'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          วันที่ {String(dayNum).padStart(2, '0')}
                        </button>
                      );
                    })}

                  <button
                    type="button"
                    onClick={() =>
                      persistScheduleChange({ includeEndOfMonth: !includeEndOfMonth })
                    }
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      includeEndOfMonth
                        ? 'bg-[#1D3C85] text-white border-[#1D3C85] font-semibold shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    สิ้นเดือน ({lastDayOfSelectedMonth})
                  </button>
                </div>

                {/* Expandable 1..31 Day Picker Grid */}
                {showDayPickerGrid && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[11px] text-slate-500 mb-1.5">
                      คลิกเลือกหรือยกเลิกวันที่ต้องการส่งในแต่ละเดือน (01 – 31):
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((dayNum) => {
                        const isSelected = scheduledDays.includes(dayNum);
                        return (
                          <button
                            key={dayNum}
                            type="button"
                            onClick={() => toggleDaySelection(dayNum)}
                            className={`py-1 text-xs font-mono tabular-nums rounded border text-center transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#1D3C85] text-white border-[#1D3C85] font-bold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {String(dayNum).padStart(2, '0')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Resolved Dates Summary for Current Selected Month */}
                <div className="pt-1.5 border-t border-slate-100 text-xs text-slate-600 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="font-medium text-slate-700">
                    รอบส่งเดือน {monthStr}/{year}:
                  </span>
                  {resolvedMonthDays.length === 0 ? (
                    <span className="text-red-600">ยังไม่ได้ระบุวันที่ส่ง</span>
                  ) : (
                    resolvedMonthDays.map((d, idx) => {
                      const dStr = `${String(d).padStart(2, '0')}/${monthStr}/${year}`;
                      const isEnd = includeEndOfMonth && d === lastDayOfSelectedMonth;
                      const isTodayDate =
                        `${year}-${monthStr}-${String(d).padStart(2, '0')}` === todayThailand;
                      return (
                        <React.Fragment key={d}>
                          {idx > 0 && <span aria-hidden="true">·</span>}
                          <span
                            className={`font-mono tabular-nums ${
                              isTodayDate
                                ? 'font-bold text-emerald-700 underline'
                                : 'text-slate-800'
                            }`}
                          >
                            {dStr}
                            {isEnd ? ' (สิ้นเดือน)' : ''}
                            {isTodayDate ? ' [วันนี้]' : ''}
                          </span>
                        </React.Fragment>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="sm:col-span-12">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                หัวข้ออีเมล (Subject)
              </label>
              <input
                type="text"
                value={customSubject}
                onChange={(e) => persistScheduleChange({ customSubject: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. Primary Send / Duplicate Prevention Lock Status */}
      <div className="pt-1 flex flex-col gap-2">
        {sentTodayLog && (
          <div className="p-3 rounded-lg bg-emerald-50/90 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-900">
                ระบบป้องกันการส่งซ้ำทำงานอยู่ (ล็อกการส่งซ้ำประจำวัน {formattedTodayThai})
              </div>
              <div className="text-emerald-800 mt-0.5">
                วันนี้มีการส่งอีเมลแจ้งเตือนไปแล้วเมื่อเวลา{' '}
                <span className="font-mono font-semibold">{sentTodayTimeText} น.</span> ระบบจะไม่ส่งซ้ำอีกในวันนี้
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleRequestSendNow}
          disabled={isSending || Boolean(sentTodayLog)}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-colors ${
            sentTodayLog
              ? 'bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed'
              : 'text-white bg-[#1D3C85] hover:bg-[#152C63] disabled:opacity-60 cursor-pointer'
          }`}
        >
          {sentTodayLog ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                ส่งอีเมลประจำวันนี้ ({formattedTodayThai}) เรียบร้อยแล้ว — ป้องกันการส่งซ้ำ
              </span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>
                ทดสอบส่งอีเมลตาราง B10 ทันที ({recipients.length} ผู้รับ)
              </span>
            </>
          )}
        </button>
      </div>

      {/* 4. Recent Sent Logs */}
      {sentLogs.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-700 mb-2">
            ประวัติการส่งอีเมลล่าสุด (บันทึกบน Server)
          </div>
          <div className="divide-y divide-slate-100 max-h-[130px] overflow-y-auto text-xs">
            {sentLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="py-1.5 flex items-center justify-between gap-2">
                <div className="truncate text-slate-600">
                  <span className="font-mono text-slate-800">
                    {new Date(log.sentAt).toLocaleString('th-TH', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span>
                    {log.triggerType === 'auto_scheduled_date'
                      ? 'ส่งอัตโนมัติตามวันนัดหมาย'
                      : log.triggerType === 'auto_price_change'
                      ? 'ส่งอัตโนมัติเมื่อปรับราคา'
                      : log.triggerType === 'auto_daily'
                      ? 'ส่งอัตโนมัติรายวัน'
                      : 'ส่งทันที'}{' '}
                    ({log.recipients.length} ท่าน)
                  </span>
                </div>
                <span className="font-mono font-semibold text-emerald-700 shrink-0 tabular-nums">
                  {log.b10Price.toFixed(2)} บาท
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Manual Test Send */}
      {confirmModal?.open && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={() => !isSending && setConfirmModal(null)}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  ยืนยันการส่งอีเมลแจ้งเตือนราคาน้ำมันดีเซล B10
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{confirmModal.reasonText}</p>
              </div>
              <button
                type="button"
                disabled={isSending}
                onClick={() => setConfirmModal(null)}
                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-md cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4 bg-slate-50">
              {/* Email Metadata Summary */}
              <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs space-y-1.5">
                <div className="flex gap-2">
                  <span className="font-semibold text-slate-500 w-24 shrink-0">ช่องทางส่ง:</span>
                  <span className="font-semibold text-emerald-700">
                    {smtpConfigured
                      ? `Server-Side SMTP (${smtpUser})`
                      : `Google Account (${user?.email || ''})`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold text-slate-500 w-24 shrink-0">
                    ผู้รับ ({recipients.length}):
                  </span>
                  <span className="font-mono text-slate-900 break-all">
                    {recipients.join(', ')}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold text-slate-500 w-24 shrink-0">
                    หัวข้อ (Subject):
                  </span>
                  <span className="font-medium text-slate-900">{resolvedSubject}</span>
                </div>
              </div>

              {/* Exact Preview of the Table inside the Email Body */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-col items-center">
                <div className="w-full flex items-center justify-between mb-2.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#1D3C85]" />
                    ตัวอย่างตารางที่จะปรากฏในเนื้อหาอีเมล (แสดงข้อมูลถึงวันปัจจุบัน)
                  </span>
                </div>

                <div className="max-h-[340px] overflow-y-auto w-full flex justify-center py-1">
                  <table className="excel-sheet-table w-full max-w-[420px] text-[14px] leading-tight">
                    <thead>
                      <tr className="h-[42px]">
                        <th className="excel-header-cell w-[115px] px-2">Date</th>
                        <th className="excel-header-cell excel-comment-indicator w-[195px] px-2">
                          <div className="inline-flex items-center justify-center gap-1.5">
                            <PttLogoIcon className="w-[16px] h-[20px] shrink-0" />
                            <span>Fuel price B10 PTT</span>
                          </div>
                        </th>
                        <th className="excel-header-cell w-[110px] px-2">EV price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => (
                        <tr key={row.isoDate} className="h-[28px] bg-white">
                          <td className="text-center font-normal text-black tabular-nums px-2">
                            {row.dateFormatted}
                          </td>
                          <td className="text-center font-bold text-black tabular-nums px-2">
                            {row.b10Display}
                          </td>
                          <td className="text-center font-bold text-black tabular-nums px-2">
                            {row.evDisplay}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isSending}
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                ยกเลิก (Cancel)
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={executeConfirmedSend}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isSending
                    ? 'กำลังส่งอีเมล...'
                    : `ยืนยันและส่งอีเมล (${recipients.length} ท่าน)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Apps Script Generator Modal (100% Sleep-Proof Automation) */}
      {showAppsScriptModal && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={() => setShowAppsScriptModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#1D3C85]" />
                  <span>
                    โค้ด Google Apps Script สำเร็จรูป (แก้ปัญหาระบบหลับ 100% + ป้องกันการส่งซ้ำ)
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  สร้างจากรายชื่อผู้รับ ({recipients.length} ท่าน) และวันที่ตั้งไว้ในระบบปัจจุบัน พร้อมทำงานอัตโนมัติบนเซิร์ฟเวอร์ Google โดยไม่ต้องเปิดแอป
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAppsScriptModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4 bg-slate-50 text-xs">
              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900">
                  วิธีนำไปตั้งค่าใน Google Apps Script (ใช้เวลาเพียง 1 นาที):
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-700">
                  <li>
                    เปิดเว็บ{' '}
                    <a
                      href="https://script.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1D3C85] font-semibold underline"
                    >
                      https://script.google.com
                    </a>{' '}
                    แล้วกด <strong>New project (โครงการใหม่)</strong>
                  </li>
                  <li>
                    กดปุ่ม <strong>&ldquo;คัดลอกโค้ด Google Apps Script&rdquo;</strong> ด้านล่าง แล้วนำไปวางทับในไฟล์ <code className="font-mono bg-slate-100 px-1 rounded">Code.gs</code> จากนั้นกดบันทึก (Save)
                  </li>
                  <li>
                    ที่แถบซ้ายมือ คลิกเมนูรูปนาฬิกา <strong>Triggers (ทริกเกอร์)</strong> &rarr; กด <strong>+ Add Trigger (เพิ่มทริกเกอร์)</strong> มุมขวาล่าง
                  </li>
                  <li>
                    ตั้งค่าดังนี้:
                    <ul className="list-disc list-inside pl-4 mt-1 space-y-0.5 text-slate-600">
                      <li>
                        ฟังก์ชันที่ทำงาน: <code className="font-mono font-semibold text-slate-900">runDailyPttB10Alert</code>
                      </li>
                      <li>
                        เลือกแหล่งที่มาของกิจกรรม: <strong>Time-driven (ตามเวลา)</strong>
                      </li>
                      <li>
                        ประเภทตัวจับเวลา: <strong>Day timer (ตัวจับเวลารายวัน)</strong>
                      </li>
                      <li>
                        ช่วงเวลาของวัน: <strong>7am to 8am (07:00 น. ถึง 08:00 น.)</strong> แล้วกด Save
                      </li>
                    </ul>
                  </li>
                </ol>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900 flex items-start gap-2.5">
                <span className="text-base leading-none">✨</span>
                <div>
                  <div className="font-bold text-emerald-950">
                    ระบบดึงค่าวันที่และผู้รับสด (Live Config Sync)
                  </div>
                  <p className="mt-0.5 text-slate-700 leading-relaxed">
                    สคริปต์นี้ถูกเขียนให้ <strong>เชื่อมต่อไปดึงวันที่กำหนดส่งและรายชื่อผู้รับจากหน้าเว็บนี้โดยตรงทุกเช้า</strong> ดังนั้นเมื่อคุณปรับเปลี่ยนวันที่ส่ง (เช่น วันที่ 22, 23, 24) หรือเพิ่ม/ลดอีเมลผู้รับในหน้าเว็บ สคริปต์จะมองเห็นและใช้ค่าใหม่โดยอัตโนมัติ ไม่จำเป็นต้องกลับมาแก้โค้ดใน Apps Script อีกรอบ
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">
                  โค้ด Code.gs (เชื่อมต่อ Live Sync อัตโนมัติ):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const scriptText = `/**
 * ระบบอัปเดตและส่งอีเมลราคาน้ำมันดีเซล B10 (Fuel price B10 PTT) อัตโนมัติ
 * ทำงานบน Google Apps Script แบบ 100% เชื่อมต่อและซิงก์วันที่/ผู้รับกับหน้าเว็บอัตโนมัติ
 * ดึงข้อมูลสดจาก http://www.pttor.com/oilprice-board.aspx
 * มีระบบป้องกันการส่งซ้ำในวันเดียวกัน
 */
const CONFIG = {
  CONFIG_URL: "${sharedPublicOrigin}/api/schedule-config",
  WAKE_UP_URL: "${sharedPublicOrigin}/api/cron-wake",
  LOG_URL: "${sharedPublicOrigin}/api/log-sent-email",
  RECIPIENTS: ${JSON.stringify(recipients)},
  SCHEDULED_DAYS: ${JSON.stringify(scheduledDays)},
  INCLUDE_END_OF_MONTH: ${JSON.stringify(includeEndOfMonth)},
  DEFAULT_EV_PRICE: ${JSON.stringify(defaultEvPrice)},
  SUBJECT_TEMPLATE: ${JSON.stringify(customSubject)},
  CUSTOM_OVERRIDES: ${JSON.stringify(customOverrides)}
};

function runDailyPttB10Alert() {
  const now = new Date();
  const tz = "Asia/Bangkok";
  const todayIso = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const year = Number(Utilities.formatDate(now, tz, "yyyy"));
  const month = Number(Utilities.formatDate(now, tz, "MM"));
  const day = Number(Utilities.formatDate(now, tz, "dd"));
  const lastDayOfMonth = new Date(year, month, 0).getDate();

  // 1. ตรวจสอบระบบป้องกันการส่งซ้ำในวันเดียวกัน
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("LAST_SENT_DATE") === todayIso) {
    Logger.log("วันนี้ (" + todayIso + ") มีการส่งอีเมลไปแล้ว ระบบป้องกันการส่งซ้ำทำงาน");
    return;
  }

  // 2. ดึงการตั้งค่าสด (Live Config) จากระบบเว็บ เพื่อให้ล้อกับวันที่และรายชื่อผู้รับที่คุณปรับในหน้าเว็บเสมอ
  let activeRecipients = CONFIG.RECIPIENTS;
  let activeDays = CONFIG.SCHEDULED_DAYS;
  let activeIncludeEndOfMonth = CONFIG.INCLUDE_END_OF_MONTH;
  let activeEvPrice = CONFIG.DEFAULT_EV_PRICE;
  let activeSubject = CONFIG.SUBJECT_TEMPLATE;
  let activeOverrides = CONFIG.CUSTOM_OVERRIDES;

  try {
    const configRes = UrlFetchApp.fetch(CONFIG.CONFIG_URL, { muteHttpExceptions: true });
    if (configRes.getResponseCode() === 200) {
      const cfgData = JSON.parse(configRes.getContentText());
      if (cfgData && cfgData.sentToday === true) {
        props.setProperty("LAST_SENT_DATE", todayIso);
        Logger.log("ระบบเว็บส่งอีเมลของวันนี้ไปเรียบร้อยแล้ว ล็อกกันส่งซ้ำ");
        return;
      }
      if (cfgData && cfgData.config) {
        const c = cfgData.config;
        if (Array.isArray(c.scheduledDays)) activeDays = c.scheduledDays;
        if (typeof c.includeEndOfMonth === "boolean") activeIncludeEndOfMonth = c.includeEndOfMonth;
        if (Array.isArray(c.recipients) && c.recipients.length > 0) activeRecipients = c.recipients;
        if (c.defaultEvPrice) activeEvPrice = c.defaultEvPrice;
        if (c.customSubject) activeSubject = c.customSubject;
        if (c.customOverrides) activeOverrides = c.customOverrides;
        Logger.log("ดึงการตั้งค่าสดสำเร็จ! วันที่กำหนดส่งล่าสุดจากระบบ: " + JSON.stringify(activeDays));
      }
    }
  } catch (err) {
    Logger.log("เซิร์ฟเวอร์เว็บหลับอยู่หรือดึงการตั้งค่าสดไม่สำเร็จ จะใช้ค่าสำรองในโค้ด: " + err);
  }

  // 3. ตรวจสอบว่าวันนี้ตรงกับวันที่กำหนดส่งหรือไม่ (ล้อตามวันที่ที่เลือกในเว็บล่าสุดแบบอัตโนมัติ)
  const isScheduledToday =
    activeDays.indexOf(day) !== -1 ||
    (activeIncludeEndOfMonth && day === lastDayOfMonth);

  if (!isScheduledToday) {
    Logger.log("วันนี้ (" + todayIso + ") ไม่ใช่วันที่มีรอบส่งอีเมลตามการตั้งค่าล่าสุด (" + JSON.stringify(activeDays) + ")");
    return;
  }

  // 4. สั่งปลุกเซิร์ฟเวอร์หลักและให้เซิร์ฟเวอร์ส่งผ่าน SMTP ก่อน หากเซิร์ฟเวอร์ทำงานสำเร็จจะส่งค่ากลับมา
  try {
    const wakeRes = UrlFetchApp.fetch(CONFIG.WAKE_UP_URL, { muteHttpExceptions: true });
    if (wakeRes.getResponseCode() === 200) {
      const wakeJson = JSON.parse(wakeRes.getContentText());
      if (wakeJson && wakeJson.sentToday === true) {
        props.setProperty("LAST_SENT_DATE", todayIso);
        Logger.log("เซิร์ฟเวอร์หลักส่งอีเมลเรียบร้อยแล้ว บันทึกล็อกกันส่งซ้ำ");
        return;
      }
    }
  } catch (e) {
    Logger.log("เซิร์ฟเวอร์หลักหลับอยู่ กำลังส่งจาก Google Apps Script โดยตรง...");
  }

  // 5. หากเซิร์ฟเวอร์ไม่พร้อม ดึงราคาน้ำมันดีเซล B10 จาก http://www.pttor.com/oilprice-board.aspx และส่งเมลโดยตรง
  sendPttB10SheetDirectly(year, month, day, todayIso, props, {
    recipients: activeRecipients,
    evPrice: activeEvPrice,
    subjectTemplate: activeSubject,
    customOverrides: activeOverrides
  });
}

function sendPttB10SheetDirectly(year, month, todayDay, todayIso, props, liveOptions) {
  liveOptions = liveOptions || {};
  const targetRecipients = Array.isArray(liveOptions.recipients) && liveOptions.recipients.length > 0 ? liveOptions.recipients : CONFIG.RECIPIENTS;
  const targetEvPrice = liveOptions.evPrice || CONFIG.DEFAULT_EV_PRICE;
  const targetSubjectTemplate = liveOptions.subjectTemplate || CONFIG.SUBJECT_TEMPLATE;
  const targetOverrides = liveOptions.customOverrides || CONFIG.CUSTOM_OVERRIDES;

  const boardRes = UrlFetchApp.fetch("http://www.pttor.com/oilprice-board.aspx", { muteHttpExceptions: true });
  const html = boardRes.getContentText();

  // ดึงข้อความวันที่ปรับราคาสดจาก obox-subhead เช่น ปรับราคาเมื่อ 21 ต.ค. 2569 05:00
  const subheadMatch = html.match(/<div\\s+class=["']obox-subhead["'][^>]*>([\\s\\S]*?)<\\/div>/i);
  const effectiveText = subheadMatch ? subheadMatch[1].replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim() : "ล่าสุด";

  const boardRegex = /<div\\s+class=["']oil-board["'][^>]*>[\\s\\S]*?<img[^>]*alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'][^>]*>[\\s\\S]*?<div\\s+class=["']oil-price["'][^>]*>([\\s\\S]*?)<\\/div>/gi;
  let match;
  let liveB10Price = 43.54;
  const items = [];
  while ((match = boardRegex.exec(html)) !== null) {
    const name = match[1].trim();
    const p = parseFloat(match[3].replace(/[^\\d.]/g, ""));
    if (!isNaN(p)) {
      items.push({ name: name, lower: name.toLowerCase(), price: p });
    }
  }

  // คัดเลือกราคาน้ำมันดีเซล B10 / ดีเซลมาตรฐาน (ป้องกันไม่ให้แมตช์โดน Diesel B20 37.19 หรือ Premium Diesel)
  const b10Found =
    items.find(function(it) {
      return (
        it.lower === "diesel" ||
        it.lower === "ดีเซล" ||
        it.lower === "diesel b10" ||
        it.lower === "ดีเซล b10" ||
        it.lower === "ultraforce diesel"
      );
    }) ||
    items.find(function(it) {
      return it.lower.indexOf("b10") !== -1;
    }) ||
    items.find(function(it) {
      return (
        it.lower.indexOf("diesel") !== -1 &&
        it.lower.indexOf("b20") === -1 &&
        it.lower.indexOf("premium") === -1 &&
        it.lower.indexOf("super") === -1
      );
    });

  if (b10Found) {
    liveB10Price = b10Found.price;
  }

  // ดึงประวัติการปรับราคาในเดือนนั้นจาก PTT OR
  const pointMap = {};
  try {
    const histRes = UrlFetchApp.fetch("https://www.pttor.com/wp-admin/admin-ajax.php", {
      method: "post",
      payload: {
        action: "fetch_oil_prices",
        province: "กรุงเทพมหานคร",
        month: "all",
        year: String(year + 543)
      },
      muteHttpExceptions: true
    });
    const histJson = JSON.parse(histRes.getContentText());
    if (histJson && Array.isArray(histJson.data)) {
      histJson.data.forEach(function(row) {
        if (!row.priceDate || !Array.isArray(row.priceData)) return;
        row.priceData.forEach(function(p) {
          const t = String(p.OilTypeId || "").trim();
          if ((t === "ดีเซล" || t === "ดีเซล B10") && typeof p.Price === "number") {
            pointMap[row.priceDate.slice(0, 10)] = Number(p.Price);
          }
        });
      });
    }
  } catch (e) {}

  pointMap[todayIso] = liveB10Price;
  const sortedDates = Object.keys(pointMap).sort();

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = ("0" + month).slice(-2);
  const todayFormatted = ("0" + todayDay).slice(-2) + "/" + monthStr + "/" + year;
  const evDisplayDefault = parseFloat(targetEvPrice || "9.60").toFixed(2);

  let rowsHtml = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = ("0" + d).slice(-2);
    const iso = year + "-" + monthStr + "-" + dStr;
    const dateFormatted = dStr + "/" + monthStr + "/" + year;

    const override = targetOverrides && targetOverrides[iso];
    let isPopulated = iso <= todayIso;
    if (override && override.forceBlank === true) {
      isPopulated = false;
    } else if (override && (override.forceBlank === false || override.b10 !== undefined || override.ev !== undefined)) {
      isPopulated = true;
    }

    let effPrice = liveB10Price;
    for (let i = 0; i < sortedDates.length; i++) {
      if (sortedDates[i] <= iso) effPrice = pointMap[sortedDates[i]];
    }

    const b10Text = isPopulated ? (override && override.b10 !== undefined ? override.b10 : effPrice.toFixed(2)) : "";
    const evText = isPopulated ? (override && override.ev !== undefined ? override.ev : evDisplayDefault) : "";

    rowsHtml += '<tr style="height: 28px; background-color: #FFFFFF;">' +
      '<td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #000000; padding: 3px 8px;">' + dateFormatted + '</td>' +
      '<td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">' + b10Text + '</td>' +
      '<td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">' + evText + '</td>' +
      '</tr>';
  }

  const subject = targetSubjectTemplate
    .replace("{today}", todayFormatted)
    .replace("{price}", liveB10Price.toFixed(2))
    .replace("{month}", monthStr)
    .replace("{year}", String(year));

  const htmlBody = '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"></head>' +
    '<body style="margin: 0; padding: 16px; background-color: #FFFFFF; font-family: Calibri, Arial, sans-serif; color: #0F172A;">' +
    '<div style="margin-bottom: 12px; font-size: 14px; color: #1E293B;">' +
    '<strong>รายงานอัปเดตราคาน้ำมันดีเซล B10 (Fuel price B10 PTT) และ EV price</strong><br/>' +
    '<span style="font-size: 12px; color: #475569;">ข้อมูลอ้างอิงจาก: <a href="http://www.pttor.com/oilprice-board.aspx" style="color: #1D3C85;">http://www.pttor.com/oilprice-board.aspx</a> (' + effectiveText + ')</span>' +
    '</div>' +
    '<table cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #000000; width: 440px; background-color: #FFFFFF;">' +
    '<thead><tr style="height: 44px; background-color: #FFFF99;">' +
    '<th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-size: 15px; font-weight: bold; text-align: center; width: 120px; padding: 6px 8px;">Date</th>' +
    '<th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-size: 15px; font-weight: bold; text-align: center; width: 205px; padding: 6px 8px;">Fuel price B10 PTT</th>' +
    '<th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; font-size: 15px; font-weight: bold; text-align: center; width: 115px; padding: 6px 8px;">EV price</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody></table></body></html>';

  MailApp.sendEmail({
    to: targetRecipients.join(","),
    name: "(ระบบแจ้งเตือนอัตโนมัติ) อัปเดตราคาน้ำมันดีเซล B10 และ EV Price",
    subject: subject,
    htmlBody: htmlBody
  });

  // บันทึกล็อกป้องกันการส่งซ้ำในวันเดียวกัน
  props.setProperty("LAST_SENT_DATE", todayIso);
  Logger.log("ส่งอีเมลสำเร็จไปยัง: " + targetRecipients.join(", ") + " (ราคา B10: " + liveB10Price.toFixed(2) + " บาท)");

  // บันทึกประวัติส่งเมลกลับมายังหน้าเว็บ Dashboard
  try {
    UrlFetchApp.fetch(CONFIG.LOG_URL || CONFIG.WAKE_UP_URL.replace("/api/cron-wake", "/api/log-sent-email"), {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        sentAt: new Date().toISOString(),
        isoDateBangkok: todayIso,
        recipients: targetRecipients,
        subject: subject,
        b10Price: liveB10Price,
        triggerType: "auto_scheduled_date"
      }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

/**
 * ฟังก์ชันทดสอบส่งอีเมลทันที (ข้ามการตรวจสอบประวัติส่งซ้ำ)
 * สามารถเลือกชื่อฟังก์ชันนี้แล้วกด Run ใน Google Apps Script เพื่อส่งอีเมลอัปเดตราคาใหม่ได้ทันที
 */
function forceSendPttB10AlertNow() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("LAST_SENT_DATE");
  const now = new Date();
  const tz = "Asia/Bangkok";
  const todayIso = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const year = Number(Utilities.formatDate(now, tz, "yyyy"));
  const month = Number(Utilities.formatDate(now, tz, "MM"));
  const day = Number(Utilities.formatDate(now, tz, "dd"));
  sendPttB10SheetDirectly(year, month, day, todayIso, props);
}`;
                    navigator.clipboard.writeText(scriptText);
                    setCopiedScript(true);
                    setTimeout(() => setCopiedScript(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
                >
                  {copiedScript ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>คัดลอกโค้ดเรียบร้อยแล้ว!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>คัดลอกโค้ด Google Apps Script</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto max-h-[260px] leading-relaxed select-all">
{`// โค้ดซิงก์อัตโนมัติกับผู้รับทั้ง ${recipients.length} ท่าน:
// ${recipients.join(', ')}
// วันที่ส่ง: ${scheduledDays.map((d) => String(d).padStart(2, '0')).join(', ')}${
                  includeEndOfMonth ? ', สิ้นเดือน' : ''
                }
// หัวข้อ: ${customSubject}
// กดปุ่ม "คัดลอกโค้ด Google Apps Script" ด้านบนเพื่อคัดลอกโค้ดฉบับเต็มไปวางใน script.google.com`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
