import 'dotenv/config';
import { spawn, execSync } from 'child_process';
import express from 'express';
import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_BOARD_URL = 'http://www.pttor.com/oilprice-board.aspx';
const PTT_HISTORY_AJAX_URL = 'https://www.pttor.com/wp-admin/admin-ajax.php';
const SCHEDULE_STORE_PATH = path.join(__dirname, 'schedule-store.json');

const TUNNEL_URL_FILE = '/tmp/public-tunnel-url.txt';
const CLOUDFLARED_LOG = '/tmp/cloudflared.log';
const CLOUDFLARED_BIN = '/tmp/cloudflared';
let publicTunnelUrl: string | null = null;
let cloudflaredProcess: any = null;

function readSavedTunnelUrl(): string | null {
  try {
    if (fs.existsSync(TUNNEL_URL_FILE)) {
      const u = fs.readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
      if (u.startsWith('https://') && u.includes('.trycloudflare.com')) {
        return u;
      }
    }
  } catch {}
  return null;
}

publicTunnelUrl = readSavedTunnelUrl();

function ensurePublicTunnel(): void {
  const existingUrl = readSavedTunnelUrl();
  let isRunning = false;
  try {
    const pgrep = execSync('pgrep -f cloudflared || true', { encoding: 'utf-8' }).trim();
    if (pgrep) isRunning = true;
  } catch {}

  if (existingUrl && isRunning) {
    publicTunnelUrl = existingUrl;
    console.log(`[Tunnel] Active Cloudflare tunnel: ${publicTunnelUrl}`);
    return;
  }

  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.log('[Tunnel] Downloading cloudflared binary...');
    try {
      execSync(
        'curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && chmod +x /tmp/cloudflared',
        { stdio: 'inherit' }
      );
    } catch (e) {
      console.error('[Tunnel] Failed to download cloudflared:', e);
      return;
    }
  }

  try {
    execSync('killall cloudflared 2>/dev/null || true');
  } catch {}

  console.log('[Tunnel] Starting cloudflared tunnel on port 3000 (protocol http2)...');
  try {
    const outFd = fs.openSync(CLOUDFLARED_LOG, 'a');
    cloudflaredProcess = spawn(
      CLOUDFLARED_BIN,
      ['tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:3000', '--no-autoupdate'],
      { stdio: ['ignore', outFd, outFd], detached: true }
    );
    try {
      fs.closeSync(outFd);
    } catch {}
    cloudflaredProcess.unref();

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      try {
        if (fs.existsSync(CLOUDFLARED_LOG)) {
          const content = fs.readFileSync(CLOUDFLARED_LOG, 'utf-8');
          const matches = content.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
          if (matches && matches.length > 0) {
            const latestUrl = matches[matches.length - 1];
            publicTunnelUrl = latestUrl;
            fs.writeFileSync(TUNNEL_URL_FILE, latestUrl, 'utf-8');
            console.log(`[Tunnel] Established public HTTPS URL: ${publicTunnelUrl}`);
            broadcastSharedState();
            clearInterval(interval);
            return;
          }
        }
      } catch (err) {
        console.error('[Tunnel] Error reading log:', err);
      }
      if (attempts > 30) {
        clearInterval(interval);
        console.warn('[Tunnel] Timed out waiting for tunnel URL');
      }
    }, 1000);
  } catch (err) {
    console.error('[Tunnel] Failed to start cloudflared:', err);
  }
}

const THAI_MONTH_ABBR: Record<string, number> = {
  'ม.ค.': 1,
  'ก.พ.': 2,
  'มี.ค.': 3,
  'เม.ย.': 4,
  'พ.ค.': 5,
  'มิ.ย.': 6,
  'ก.ค.': 7,
  'ส.ค.': 8,
  'ก.ย.': 9,
  'ต.ค.': 10,
  'พ.ย.': 11,
  'ธ.ค.': 12,
};

interface BoardFuelItem {
  name: string;
  price: number;
  logoUrl: string;
}

interface PriceChangePoint {
  isoDate: string; // YYYY-MM-DD
  priceDateRaw: string;
  price: number;
  source: 'oilprice-board.aspx' | 'pttor-history';
}

export interface DailyScheduleItem {
  day: number;
  isoDate: string;
  dateFormatted: string;
  b10Price: number;
  effectiveFrom: string;
  source: 'oilprice-board.aspx' | 'pttor-history';
  isChangeDay: boolean;
  priceDelta: number;
  isFuture: boolean;
}

export type AutoTriggerMode =
  | 'specific_dates'
  | 'specific_dates_and_change'
  | 'daily_time'
  | 'on_price_change';

export interface SentEmailLog {
  id: string;
  sentAt: string;
  isoDateBangkok: string;
  recipients: string[];
  subject: string;
  b10Price: number;
  triggerType: 'manual' | 'auto_scheduled_date' | 'auto_daily' | 'auto_price_change';
  channel: 'server_smtp' | 'client_gmail';
}

export interface ServerScheduleStore {
  recipients: string[];
  autoEnabled: boolean;
  triggerMode: AutoTriggerMode;
  scheduledDays: number[];
  includeEndOfMonth: boolean;
  scheduledTime: string;
  defaultEvPrice: string;
  customSubject: string;
  customOverrides: Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>;
  sentLogs: SentEmailLog[];
  sentDateLocks: Record<string, SentEmailLog>;
  lastSentDateBangkok: string | null;
  updatedAt?: number;
}

const NEW_DEFAULT_SUBJECT = 'อัปเดตราคาน้ำมันดีเซล B10 และ EV Price ประจำวันที่ {today}';
const LEGACY_DEFAULT_SUBJECT =
  'อัปเดตราคาน้ำมันดีเซล B10 (Fuel price B10 PTT) ประจำวันที่ {today} — {price} บาท/ลิตร';

const DEFAULT_RECIPIENTS = [
  'Chawalit.M@pttgcgroup.com',
  'Ronpol.P@pttgcgroup.com',
  'Anuwat.K@pttgcgroup.com',
  'Prasit.Su@pttgcgroup.com',
  'Sirilak.S@pttgcgroup.com',
];

const DEFAULT_STORE: ServerScheduleStore = {
  recipients: DEFAULT_RECIPIENTS,
  autoEnabled: true,
  triggerMode: 'specific_dates',
  scheduledDays: [1, 10, 20],
  includeEndOfMonth: true,
  scheduledTime: '08:00',
  defaultEvPrice: '9.60',
  customSubject: NEW_DEFAULT_SUBJECT,
  customOverrides: {},
  sentLogs: [],
  sentDateLocks: {},
  lastSentDateBangkok: null,
  updatedAt: 0,
};

function loadScheduleStore(): ServerScheduleStore {
  try {
    if (fs.existsSync(SCHEDULE_STORE_PATH)) {
      const raw = fs.readFileSync(SCHEDULE_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const sentLogs: SentEmailLog[] = Array.isArray(parsed.sentLogs) ? parsed.sentLogs : [];
      const sentDateLocks: Record<string, SentEmailLog> =
        parsed.sentDateLocks && typeof parsed.sentDateLocks === 'object'
          ? { ...parsed.sentDateLocks }
          : {};

      // Backfill sentDateLocks from existing sentLogs so any date already sent is locked
      for (const log of sentLogs) {
        if (log?.isoDateBangkok && !sentDateLocks[log.isoDateBangkok]) {
          sentDateLocks[log.isoDateBangkok] = log;
        }
      }

      // Automatically scan .sent_locks directory to restore any sent logs from disk
      try {
        const lockDirPath = path.join(__dirname, '.sent_locks');
        if (fs.existsSync(lockDirPath)) {
          const lockFiles = fs.readdirSync(lockDirPath);
          for (const lf of lockFiles) {
            if (lf.endsWith('.lock')) {
              try {
                const lockObj = JSON.parse(fs.readFileSync(path.join(lockDirPath, lf), 'utf-8'));
                if (lockObj && lockObj.isoDateBangkok) {
                  if (!sentDateLocks[lockObj.isoDateBangkok]) {
                    sentDateLocks[lockObj.isoDateBangkok] = lockObj;
                  }
                  if (!sentLogs.some((l) => l.isoDateBangkok === lockObj.isoDateBangkok)) {
                    sentLogs.unshift(lockObj);
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}

      const lastSentDateBangkok =
        parsed.lastSentDateBangkok ||
        (sentLogs.length > 0 ? sentLogs[0].isoDateBangkok : null);

      const resolvedSubject =
        !parsed.customSubject || parsed.customSubject === LEGACY_DEFAULT_SUBJECT
          ? NEW_DEFAULT_SUBJECT
          : parsed.customSubject;

      const rawRecipients: string[] = Array.isArray(parsed.recipients)
        ? parsed.recipients
        : DEFAULT_RECIPIENTS;
      const cleanRecipients = rawRecipients
        .map((r) => String(r || '').trim())
        .filter((r) => r && r.toLowerCase() !== 'paragon.lg01@gmail.com');

      return {
        ...DEFAULT_STORE,
        ...parsed,
        customSubject: resolvedSubject,
        recipients: cleanRecipients.length > 0 ? cleanRecipients : DEFAULT_RECIPIENTS,
        scheduledDays: Array.isArray(parsed.scheduledDays)
          ? parsed.scheduledDays
          : DEFAULT_STORE.scheduledDays,
        sentLogs,
        sentDateLocks,
        lastSentDateBangkok,
        customOverrides: parsed.customOverrides || {},
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    }
  } catch (err) {
    console.error('Failed to load schedule-store.json:', err);
  }
  return { ...DEFAULT_STORE };
}

const sseClients = new Set<express.Response>();

function broadcastSharedState(): void {
  if (sseClients.size === 0) return;
  const todayIso = getThailandTodayIso();
  const sentTodayLog =
    (scheduleStore.sentDateLocks && scheduleStore.sentDateLocks[todayIso]) ||
    scheduleStore.sentLogs.find((log) => log.isoDateBangkok === todayIso) ||
    null;

  const payload = JSON.stringify({
    type: 'state:sync',
    publicTunnelUrl: publicTunnelUrl || readSavedTunnelUrl(),
    smtpConfigured: isSmtpConfigured(),
    smtpUser: process.env.SMTP_USER?.trim() || '',
    todayIsoBangkok: todayIso,
    sentToday: Boolean(sentTodayLog),
    sentTodayLog,
    connectedClients: sseClients.size,
    config: scheduleStore,
  });

  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function saveScheduleStore(store: ServerScheduleStore): void {
  try {
    fs.writeFileSync(SCHEDULE_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    broadcastSharedState();
  } catch (err) {
    console.error('Failed to save schedule-store.json:', err);
  }
}

let scheduleStore: ServerScheduleStore = loadScheduleStore();
// Ensure backfilled sentDateLocks are persisted immediately
saveScheduleStore(scheduleStore);

function getThailandTodayIso(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}

function getThailandNowTime(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()); // HH:mm
}

function isSmtpConfigured(): boolean {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return Boolean(
    user &&
      pass &&
      pass !== 'YOUR_16_CHARACTER_GMAIL_APP_PASSWORD' &&
      pass !== 'MY_SMTP_PASS'
  );
}

function parseThaiEffectiveDate(subheadText: string): {
  effectiveText: string;
  effectiveIsoDate: string | null;
  effectiveTime: string | null;
} {
  const cleaned = subheadText.replace(/\s+/g, ' ').trim();
  // Example: "ปรับราคาเมื่อ 9 ต.ค. 2569 05:00"
  const match = cleaned.match(/(\d{1,2})\s+([ก-๙.]+)\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (!match) {
    return { effectiveText: cleaned, effectiveIsoDate: null, effectiveTime: null };
  }
  const day = parseInt(match[1], 10);
  const monthAbbr = match[2];
  const buddhistYear = parseInt(match[3], 10);
  const timeStr = match[4] || '05:00';
  const month = THAI_MONTH_ABBR[monthAbbr] || 1;
  const gregorianYear = buddhistYear > 2400 ? buddhistYear - 543 : buddhistYear;

  const isoDate = `${gregorianYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    effectiveText: cleaned,
    effectiveIsoDate: isoDate,
    effectiveTime: timeStr,
  };
}

async function scrapePttOilPriceBoard() {
  const response = await fetch(SOURCE_BOARD_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_BOARD_URL} (HTTP ${response.status})`);
  }

  const html = await response.text();

  // Extract obox-subhead
  const subheadMatch = html.match(/<div\s+class=["']obox-subhead["'][^>]*>([\s\S]*?)<\/div>/i);
  const rawSubhead = subheadMatch ? subheadMatch[1].replace(/<[^>]+>/g, ' ') : '';
  const { effectiveText, effectiveIsoDate, effectiveTime } = parseThaiEffectiveDate(rawSubhead);

  // Extract each .oil-board block
  const boardRegex =
    /<div\s+class=["']oil-board["'][^>]*>[\s\S]*?<img[^>]*alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<div\s+class=["']oil-price["'][^>]*>([\s\S]*?)<\/div>/gi;

  const items: BoardFuelItem[] = [];
  let match: RegExpExecArray | null;
  while ((match = boardRegex.exec(html)) !== null) {
    const name = match[1].trim();
    const logoUrl = match[2].trim();
    const priceText = match[3].replace(/[^\d.]/g, '').trim();
    const price = parseFloat(priceText);
    if (!Number.isNaN(price)) {
      items.push({ name, price, logoUrl });
    }
  }

  // Standard Diesel in PTT OR oilprice-board is alt="Diesel" (Diesel B10 / High Speed Diesel)
  // Must strictly avoid Diesel B20 (37.19) or Premium Diesel (50.05)
  const b10Item =
    items.find((item) => {
      const lower = item.name.toLowerCase().trim();
      return (
        lower === 'diesel' ||
        lower === 'ดีเซล' ||
        lower === 'diesel b10' ||
        lower === 'ดีเซล b10' ||
        lower === 'ultraforce diesel'
      );
    }) ||
    items.find((item) => {
      const lower = item.name.toLowerCase().trim();
      return lower.includes('b10');
    }) ||
    items.find((item) => {
      const lower = item.name.toLowerCase().trim();
      return (
        lower.includes('diesel') &&
        !lower.includes('b20') &&
        !lower.includes('premium') &&
        !lower.includes('super')
      );
    });

  if (!b10Item) {
    throw new Error('Could not locate Diesel B10 row on http://www.pttor.com/oilprice-board.aspx');
  }

  return {
    sourceUrl: SOURCE_BOARD_URL,
    fetchedAt: new Date().toISOString(),
    effectiveText,
    effectiveIsoDate,
    effectiveTime,
    b10Price: b10Item.price,
    b10Name: b10Item.name,
    b10LogoUrl: b10Item.logoUrl,
    allBoardItems: items,
  };
}

async function fetchPttHistoricalDieselChanges(gregorianYear: number): Promise<PriceChangePoint[]> {
  const buddhistYears = [gregorianYear + 543, gregorianYear + 542];
  const points: PriceChangePoint[] = [];

  for (const beYear of buddhistYears) {
    try {
      const res = await fetch(PTT_HISTORY_AJAX_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Referer: SOURCE_BOARD_URL,
        },
        body: new URLSearchParams({
          action: 'fetch_oil_prices',
          province: 'กรุงเทพมหานคร',
          month: 'all',
          year: String(beYear),
        }),
      });

      if (!res.ok) continue;
      const json = (await res.json()) as {
        success?: boolean;
        data?: Array<{
          priceDate: string;
          priceData?: Array<{ OilTypeId: string; Price: number }>;
        }>;
      };

      if (Array.isArray(json.data)) {
        for (const row of json.data) {
          if (!row.priceDate || !Array.isArray(row.priceData)) continue;
          const dieselEntry = row.priceData.find(
            (p) =>
              String(p.OilTypeId).trim() === 'ดีเซล' ||
              String(p.OilTypeId).trim() === 'ดีเซล B10'
          );
          if (dieselEntry && typeof dieselEntry.Price === 'number') {
            const isoDate = row.priceDate.slice(0, 10);
            points.push({
              isoDate,
              priceDateRaw: row.priceDate,
              price: Number(dieselEntry.Price),
              source: 'pttor-history',
            });
          }
        }
      }
    } catch {
      // Ignore individual year errors if live board is present
    }
  }

  return points;
}

async function buildMonthlyB10Payload(year: number, month: number) {
  const todayIso = getThailandTodayIso();
  const [liveBoard, historyPoints] = await Promise.all([
    scrapePttOilPriceBoard(),
    fetchPttHistoricalDieselChanges(year),
  ]);

  const pointMap = new Map<string, PriceChangePoint>();
  for (const pt of historyPoints) {
    pointMap.set(pt.isoDate, pt);
  }

  const boardIsoDate = liveBoard.effectiveIsoDate || todayIso;
  pointMap.set(boardIsoDate, {
    isoDate: boardIsoDate,
    priceDateRaw: `${boardIsoDate}T${liveBoard.effectiveTime || '05:00'}`,
    price: liveBoard.b10Price,
    source: 'oilprice-board.aspx',
  });

  const sortedChanges = Array.from(pointMap.values()).sort((a, b) =>
    a.isoDate.localeCompare(b.isoDate)
  );

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailySchedule: DailyScheduleItem[] = [];
  let previousDayPrice: number | null = null;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    const isoDate = `${year}-${monthStr}-${dayStr}`;
    const dateFormatted = `${dayStr}/${monthStr}/${year}`;

    let activeChange: PriceChangePoint | null = null;
    for (const change of sortedChanges) {
      if (change.isoDate <= isoDate) {
        activeChange = change;
      } else {
        break;
      }
    }

    const effectivePrice = activeChange ? activeChange.price : liveBoard.b10Price;
    const isChangeDay = sortedChanges.some((c) => c.isoDate === isoDate);
    const priceDelta =
      previousDayPrice !== null ? Number((effectivePrice - previousDayPrice).toFixed(2)) : 0;

    previousDayPrice = effectivePrice;

    dailySchedule.push({
      day,
      isoDate,
      dateFormatted,
      b10Price: effectivePrice,
      effectiveFrom: activeChange ? activeChange.priceDateRaw : `${boardIsoDate}T05:00`,
      source: activeChange ? activeChange.source : 'oilprice-board.aspx',
      isChangeDay,
      priceDelta,
      isFuture: isoDate > todayIso,
    });
  }

  return {
    todayIso,
    year,
    month,
    liveBoard,
    priceChanges: sortedChanges.filter((c) => c.isoDate.startsWith(`${year}-`)),
    dailySchedule,
  };
}

function buildServerEmailHtml(
  dailySchedule: DailyScheduleItem[],
  effectiveText: string,
  defaultEvPrice: string,
  customOverrides: Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>
): string {
  const parsedEv = parseFloat(defaultEvPrice);
  const formattedDefaultEv = Number.isNaN(parsedEv) ? '9.60' : parsedEv.toFixed(2);

  const rowsHtml = dailySchedule
    .map((row) => {
      const override = customOverrides[row.isoDate];
      let isPopulated = !row.isFuture;
      if (override?.forceBlank === true) {
        isPopulated = false;
      } else if (
        override?.forceBlank === false ||
        override?.b10 !== undefined ||
        override?.ev !== undefined
      ) {
        isPopulated = true;
      }

      const b10Display = isPopulated
        ? override?.b10 !== undefined
          ? override.b10
          : row.b10Price.toFixed(2)
        : '';

      const evDisplay = isPopulated
        ? override?.ev !== undefined
          ? override.ev
          : formattedDefaultEv
        : '';

      return `
        <tr style="height: 28px; background-color: #FFFFFF;">
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #000000; padding: 3px 8px;">${row.dateFormatted}</td>
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">${b10Display}</td>
          <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000000; padding: 3px 8px;">${evDisplay}</td>
        </tr>`;
    })
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
}

// In-flight date lock to prevent concurrent duplicate sends on the same Thailand calendar date
const inFlightSendDates = new Set<string>();

// Hard-coded permanent lock dates that can NEVER be cleared or sent again on that day
const PERMANENT_SENT_DATES = new Set<string>([
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
  '2026-10-26',
]);

const LOCK_DIR = path.join(__dirname, '.sent_locks');
try {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
} catch {}

function getLockFilePath(isoDateBangkok: string): string {
  return path.join(LOCK_DIR, `${isoDateBangkok}.lock`);
}

function getTmpLockFilePath(isoDateBangkok: string): string {
  return path.join('/tmp', `ptt_b10_${isoDateBangkok}.lock`);
}

function isDateAlreadySent(isoDateBangkok: string): boolean {
  if (PERMANENT_SENT_DATES.has(isoDateBangkok)) return true;

  try {
    if (fs.existsSync(getLockFilePath(isoDateBangkok))) return true;
    if (fs.existsSync(getTmpLockFilePath(isoDateBangkok))) return true;
  } catch {}

  if (scheduleStore.sentDateLocks && scheduleStore.sentDateLocks[isoDateBangkok]) {
    return true;
  }

  if (
    Array.isArray(scheduleStore.sentLogs) &&
    scheduleStore.sentLogs.some((l) => l.isoDateBangkok === isoDateBangkok)
  ) {
    return true;
  }

  return false;
}

function recordPermanentDateLock(isoDateBangkok: string, log: SentEmailLog): void {
  PERMANENT_SENT_DATES.add(isoDateBangkok);
  try {
    if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
    fs.writeFileSync(getLockFilePath(isoDateBangkok), JSON.stringify(log, null, 2), 'utf-8');
  } catch {}
  try {
    fs.writeFileSync(getTmpLockFilePath(isoDateBangkok), JSON.stringify(log, null, 2), 'utf-8');
  } catch {}
}

function getSentLogForDate(isoDateBangkok: string): SentEmailLog | null {
  if (scheduleStore.sentDateLocks && scheduleStore.sentDateLocks[isoDateBangkok]) {
    return scheduleStore.sentDateLocks[isoDateBangkok];
  }
  const found = scheduleStore.sentLogs.find((log) => log.isoDateBangkok === isoDateBangkok);
  if (found) return found;

  // Check persistent disk locks
  try {
    const p1 = getLockFilePath(isoDateBangkok);
    if (fs.existsSync(p1)) {
      const parsed = JSON.parse(fs.readFileSync(p1, 'utf-8'));
      if (parsed && parsed.isoDateBangkok) return parsed;
    }
    const p2 = getTmpLockFilePath(isoDateBangkok);
    if (fs.existsSync(p2)) {
      const parsed = JSON.parse(fs.readFileSync(p2, 'utf-8'));
      if (parsed && parsed.isoDateBangkok) return parsed;
    }
  } catch {}

  if (PERMANENT_SENT_DATES.has(isoDateBangkok)) {
    return {
      id: `hardlock_${isoDateBangkok}`,
      sentAt: new Date().toISOString(),
      isoDateBangkok,
      recipients: scheduleStore.recipients,
      subject: scheduleStore.customSubject,
      b10Price: 43.54,
      triggerType: 'auto_scheduled_date',
      channel: 'server_smtp',
    };
  }

  return null;
}

function formatTimeBangkok(isoTimestamp: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoTimestamp));
  } catch {
    return '';
  }
}

async function sendServerSmtpEmail(
  triggerType: SentEmailLog['triggerType'],
  overrideYear?: number,
  overrideMonth?: number
): Promise<SentEmailLog> {
  if (!isSmtpConfigured()) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า SMTP_USER และ SMTP_PASS (Gmail App Password) ใน Secrets ของระบบ'
    );
  }

  if (scheduleStore.recipients.length === 0) {
    throw new Error('กรุณาเพิ่มรายชื่ออีเมลผู้รับอย่างน้อย 1 รายการ');
  }

  const todayIso = getThailandTodayIso();
  const [tY, tM, tD] = todayIso.split('-');
  const formattedTodayThai = `${tD}/${tM}/${tY}`;

  // Strict Duplicate-Send Prevention: Check if an email was already sent today or is currently in-flight
  const existingLogToday = getSentLogForDate(todayIso);
  if (existingLogToday) {
    const sentTimeStr = formatTimeBangkok(existingLogToday.sentAt);
    throw new Error(
      `ระบบป้องกันการส่งซ้ำ: วันนี้ (${formattedTodayThai}) มีการส่งอีเมลแจ้งเตือนไปแล้วเมื่อเวลา ${sentTimeStr} น. ระบบจึงล็อกไม่ให้ส่งซ้ำอีกในวันนี้`
    );
  }

  if (inFlightSendDates.has(todayIso)) {
    throw new Error(
      `ระบบป้องกันการส่งซ้ำ: กำลังดำเนินการส่งอีเมลของวันนี้ (${formattedTodayThai}) อยู่ กรุณารอสักครู่`
    );
  }

  inFlightSendDates.add(todayIso);
  try {
    const [defaultYear, defaultMonth] = todayIso.split('-').map(Number);
    const targetYear = overrideYear || defaultYear;
    const targetMonth = overrideMonth || defaultMonth;

    const payload = await buildMonthlyB10Payload(targetYear, targetMonth);

    const resolvedSubject = scheduleStore.customSubject
      .replace('{today}', formattedTodayThai)
      .replace('{price}', payload.liveBoard.b10Price.toFixed(2))
      .replace('{month}', String(targetMonth).padStart(2, '0'))
      .replace('{year}', String(targetYear));

    const htmlBody = buildServerEmailHtml(
      payload.dailySchedule,
      payload.liveBoard.effectiveText,
      scheduleStore.defaultEvPrice,
      scheduleStore.customOverrides
    );

    const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const user = process.env.SMTP_USER!.trim();
    const pass = process.env.SMTP_PASS!.trim();

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const senderDisplayName =
      '(ระบบแจ้งเตือนอัตโนมัติ) อัปเดตราคาน้ำมันดีเซล B10 และ EV Price';

    const info = await transporter.sendMail({
      from: `"${senderDisplayName}" <${user}>`,
      to: scheduleStore.recipients.join(', '),
      subject: resolvedSubject,
      html: htmlBody,
    });

    const newLog: SentEmailLog = {
      id: info.messageId || String(Date.now()),
      sentAt: new Date().toISOString(),
      isoDateBangkok: todayIso,
      recipients: [...scheduleStore.recipients],
      subject: resolvedSubject,
      b10Price: payload.liveBoard.b10Price,
      triggerType,
      channel: 'server_smtp',
    };

    scheduleStore.sentLogs = [newLog, ...scheduleStore.sentLogs].slice(0, 50);
    scheduleStore.sentDateLocks = {
      ...(scheduleStore.sentDateLocks || {}),
      [todayIso]: newLog,
    };
    scheduleStore.lastSentDateBangkok = todayIso;
    saveScheduleStore(scheduleStore);
    recordPermanentDateLock(todayIso, newLog);
    return newLog;
  } finally {
    inFlightSendDates.delete(todayIso);
  }
}

// 24/7 Server-Side Background Cron Worker
let isCronRunning = false;
async function runBackgroundScheduleTick() {
  if (isCronRunning) return;
  if (!scheduleStore.autoEnabled || scheduleStore.recipients.length === 0) return;
  if (!isSmtpConfigured()) return;

  const todayIso = getThailandTodayIso();

  // STRICT DUPLICATE GUARD: If ANY email was already sent today (or is in flight or hard-locked), never send again today!
  if (isDateAlreadySent(todayIso) || inFlightSendDates.has(todayIso)) {
    return;
  }

  isCronRunning = true;
  try {
    const nowTime = getThailandNowTime(); // HH:mm
    const [tYear, tMonth, tDay] = todayIso.split('-').map(Number);
    const lastDayOfMonth = new Date(tYear, tMonth, 0).getDate();

    const isScheduledDateToday =
      scheduleStore.scheduledDays.includes(tDay) ||
      (scheduleStore.includeEndOfMonth && tDay === lastDayOfMonth);

    const mode = scheduleStore.triggerMode;

    // Check trigger window: current time must be within 15 minutes of scheduledTime (e.g., 08:00 to 08:15)
    // Prevents rogue sends hours later when server boots or wakes up!
    const [schedH, schedM] = scheduleStore.scheduledTime.split(':').map(Number);
    const [nowH, nowM] = nowTime.split(':').map(Number);
    const schedTotalMins = (schedH || 0) * 60 + (schedM || 0);
    const nowTotalMins = (nowH || 0) * 60 + (nowM || 0);
    const isWithinTriggerWindow =
      nowTotalMins >= schedTotalMins && nowTotalMins <= schedTotalMins + 15;

    // 1. Specific Dates of Month (01, 10, 20, End of Month)
    if (
      (mode === 'specific_dates' || mode === 'specific_dates_and_change') &&
      isScheduledDateToday &&
      isWithinTriggerWindow
    ) {
      console.log(`[Server Cron] Sending scheduled monthly email for ${todayIso} at ${nowTime}`);
      await sendServerSmtpEmail('auto_scheduled_date');
      return;
    }

    // 2. Daily Scheduled Time
    if (mode === 'daily_time' && isWithinTriggerWindow) {
      console.log(`[Server Cron] Sending daily scheduled email for ${todayIso} at ${nowTime}`);
      await sendServerSmtpEmail('auto_daily');
      return;
    }

    // 3. On Price Change
    if (mode === 'on_price_change' || mode === 'specific_dates_and_change') {
      if (scheduleStore.sentLogs.length > 0) {
        const liveBoard = await scrapePttOilPriceBoard();
        const lastLoggedPrice = scheduleStore.sentLogs[0].b10Price;
        if (liveBoard.b10Price !== lastLoggedPrice) {
          console.log(
            `[Server Cron] Price change detected (${lastLoggedPrice} -> ${liveBoard.b10Price}). Sending email.`
          );
          await sendServerSmtpEmail('auto_price_change');
        }
      }
    }
  } catch (err) {
    console.error('[Server Cron] Error in background schedule check:', err);
  } finally {
    isCronRunning = false;
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // 1. Live PTT B10 Price Board & Monthly Schedule API
  app.get('/api/ptt-b10', async (req, res) => {
    try {
      const todayIso = getThailandTodayIso();
      const [defaultYear, defaultMonth] = todayIso.split('-').map(Number);

      const year = req.query.year ? parseInt(String(req.query.year), 10) : defaultYear;
      const month = req.query.month ? parseInt(String(req.query.month), 10) : defaultMonth;

      const payload = await buildMonthlyB10Payload(year, month);

      res.json({
        success: true,
        sourceUrl: SOURCE_BOARD_URL,
        todayThailand: payload.todayIso,
        year: payload.year,
        month: payload.month,
        liveBoard: payload.liveBoard,
        priceChanges: payload.priceChanges,
        dailySchedule: payload.dailySchedule,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error fetching PTT oil price board';
      res.status(500).json({
        success: false,
        error: message,
        sourceUrl: SOURCE_BOARD_URL,
      });
    }
  });

  // 1b. Standalone Print-Ready Sheet Page (bypasses iframe print sandbox restrictions)
  app.get('/api/print-sheet', async (req, res) => {
    try {
      const todayIso = getThailandTodayIso();
      const [defaultYear, defaultMonth] = todayIso.split('-').map(Number);

      const year = req.query.year ? parseInt(String(req.query.year), 10) : defaultYear;
      const month = req.query.month ? parseInt(String(req.query.month), 10) : defaultMonth;
      const evParam = req.query.ev ? String(req.query.ev) : scheduleStore.defaultEvPrice;

      let overrides = scheduleStore.customOverrides || {};
      if (typeof req.query.overrides === 'string' && req.query.overrides.trim()) {
        try {
          overrides = JSON.parse(req.query.overrides);
        } catch {
          // fallback to server store overrides
        }
      }

      const payload = await buildMonthlyB10Payload(year, month);
      const parsedEv = parseFloat(evParam);
      const formattedEv = Number.isNaN(parsedEv) ? '9.60' : parsedEv.toFixed(2);

      const rowsHtml = payload.dailySchedule
        .map((row) => {
          const ov = overrides[row.isoDate];
          let isPopulated = !row.isFuture;
          if (ov?.forceBlank === true) {
            isPopulated = false;
          } else if (ov?.forceBlank === false || ov?.b10 !== undefined || ov?.ev !== undefined) {
            isPopulated = true;
          }

          const b10Display = isPopulated
            ? ov?.b10 !== undefined
              ? ov.b10
              : row.b10Price.toFixed(2)
            : '';
          const evDisplay = isPopulated
            ? ov?.ev !== undefined
              ? ov.ev
              : formattedEv
            : '';

          return `
            <tr>
              <td class="cell-date">${row.dateFormatted}</td>
              <td class="cell-num">${b10Display}</td>
              <td class="cell-num">${evDisplay}</td>
            </tr>`;
        })
        .join('');

      const monthStr = String(month).padStart(2, '0');
      const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>พิมพ์ตารางราคาน้ำมันดีเซล B10 (${monthStr}/${year})</title>
  <style>
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: Calibri, 'Plus Jakarta Sans', 'IBM Plex Sans Thai', Arial, sans-serif;
      background: #F8FAFC;
      color: #0F172A;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .toolbar {
      width: 100%;
      max-width: 460px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 10px;
    }
    .btn-print {
      background: #1D3C85;
      color: #FFFFFF;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-print:hover {
      background: #152C63;
    }
    table.sheet {
      border-collapse: collapse;
      border: 1px solid #000000;
      width: 454px;
      background: #FFFFFF;
    }
    table.sheet th,
    table.sheet td {
      border: 1px solid #000000;
    }
    table.sheet thead tr {
      height: 46px;
      background-color: #FFFF99 !important;
    }
    table.sheet th {
      background-color: #FFFF99 !important;
      color: #0000FF !important;
      font-size: 15px;
      font-weight: bold;
      text-align: center;
      position: relative;
      padding: 0 8px;
    }
    .comment-triangle {
      position: absolute;
      top: 0;
      right: 0;
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-top: 7px solid #FF0000;
    }
    .header-b10-inner {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    table.sheet tbody tr {
      height: 30px;
      background-color: #FFFFFF;
    }
    td.cell-date {
      text-align: center;
      font-size: 15px;
      font-weight: normal;
      color: #000000;
      font-variant-numeric: tabular-nums;
    }
    td.cell-num {
      text-align: center;
      font-size: 15px;
      font-weight: bold;
      color: #000000;
      font-variant-numeric: tabular-nums;
    }
    @media print {
      body {
        background: #FFFFFF;
        padding: 0;
      }
      .toolbar {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span style="font-size: 13px; font-weight: 600; color: #334155;">ตารางราคาน้ำมันดีเซล B10 (${monthStr}/${year})</span>
    <button type="button" class="btn-print" onclick="window.print()">สั่งพิมพ์ / บันทึก PDF</button>
  </div>

  <table class="sheet">
    <thead>
      <tr>
        <th style="width: 124px;">Date</th>
        <th style="width: 212px;">
          <div class="comment-triangle"></div>
          <div class="header-b10-inner">
            <svg viewBox="0 0 36 46" width="18" height="23" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 1.5C18 1.5 3.5 18.2 3.5 29.5C3.5 37.5081 9.99187 44 18 44C26.0081 44 32.5 37.5081 32.5 29.5C32.5 18.2 18 1.5 18 1.5Z" fill="#1D3C85" />
              <path d="M18 9.5C18 9.5 8 21.8 8 30.2C8 35.7228 12.4772 40.2 18 40.2C23.5228 40.2 28 35.7228 28 30.2C28 21.8 18 9.5 18 9.5Z" fill="#00AEEF" />
              <path d="M18 18.5C18 18.5 12.2 26.2 12.2 31.4C12.2 34.6033 14.7967 37.2 18 37.2C21.2033 37.2 23.8 34.6033 23.8 31.4C23.8 26.2 18 18.5 18 18.5Z" fill="#ED1C24" />
            </svg>
            <span>Fuel price B10 PTT</span>
          </div>
        </th>
        <th style="width: 118px;">EV price</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.print();
      }, 250);
    });
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      res.status(500).send('ไม่สามารถสร้างหน้าสำหรับพิมพ์ได้');
    }
  });

  // Dedicated Binary ZIP Download Endpoint
  app.get('/api/download-zip', (_req, res) => {
    const zipPath = path.join(__dirname, 'public', 'ptt-b10-oil-tracker.zip');
    if (fs.existsSync(zipPath)) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="ptt-b10-oil-tracker.zip"');
      res.sendFile(zipPath);
    } else {
      res.status(404).send('ZIP file not found');
    }
  });

  // 2. Get Server-Side Schedule Config & Status
  app.get('/api/schedule-config', (_req, res) => {
    const todayIso = getThailandTodayIso();
    const sentTodayLog = getSentLogForDate(todayIso);
    res.json({
      success: true,
      publicTunnelUrl: publicTunnelUrl || readSavedTunnelUrl(),
      smtpConfigured: isSmtpConfigured(),
      smtpUser: process.env.SMTP_USER?.trim() || '',
      smtpHost: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      serverTimeBangkok: `${todayIso} ${getThailandNowTime()}`,
      todayIsoBangkok: todayIso,
      sentToday: Boolean(sentTodayLog),
      sentTodayLog,
      config: scheduleStore,
    });
  });

  // 3. Update Server-Side Schedule Config (never removes existing recipients or sentDateLocks)
  app.post('/api/schedule-config', (req, res) => {
    const body = req.body || {};

    let mergedRecipients = [...scheduleStore.recipients];
    if (body.replaceRecipients === true && Array.isArray(body.recipients)) {
      mergedRecipients = body.recipients
        .map((c: string) => String(c || '').trim())
        .filter((c: string) => c && c.toLowerCase() !== 'paragon.lg01@gmail.com');
    } else if (Array.isArray(body.recipients)) {
      const existingLower = new Set(mergedRecipients.map((e) => e.toLowerCase()));
      for (const candidate of body.recipients) {
        const clean = String(candidate || '').trim();
        if (
          clean &&
          clean.toLowerCase() !== 'paragon.lg01@gmail.com' &&
          !existingLower.has(clean.toLowerCase())
        ) {
          mergedRecipients.push(clean);
          existingLower.add(clean.toLowerCase());
        }
      }
    }

    // Merge sentLogs & sentDateLocks non-destructively so duplicate-prevention lock is never lost
    const mergedSentLogs = [...scheduleStore.sentLogs];
    const existingLogIds = new Set(mergedSentLogs.map((l) => l.id));
    const mergedDateLocks: Record<string, SentEmailLog> = {
      ...(scheduleStore.sentDateLocks || {}),
    };

    if (Array.isArray(body.sentLogs)) {
      for (const incomingLog of body.sentLogs) {
        if (incomingLog && incomingLog.id && !existingLogIds.has(incomingLog.id)) {
          mergedSentLogs.unshift(incomingLog);
          existingLogIds.add(incomingLog.id);
        }
        if (incomingLog?.isoDateBangkok && !mergedDateLocks[incomingLog.isoDateBangkok]) {
          mergedDateLocks[incomingLog.isoDateBangkok] = incomingLog;
        }
      }
    }

    const incomingUpdatedAt =
      typeof body.updatedAt === 'number' && body.updatedAt > 0 ? body.updatedAt : Date.now();
    const currentUpdatedAt = scheduleStore.updatedAt || 0;

    const normalizedScheduledDays: number[] | null = Array.isArray(body.scheduledDays)
      ? Array.from<number>(
          new Set<number>(
            body.scheduledDays
              .map((d: any) => Number(d))
              .filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 31)
          )
        ).sort((a, b) => a - b)
      : null;

    const hasScheduleFields =
      typeof body.autoEnabled === 'boolean' ||
      typeof body.triggerMode === 'string' ||
      normalizedScheduledDays !== null ||
      typeof body.includeEndOfMonth === 'boolean' ||
      typeof body.scheduledTime === 'string' ||
      typeof body.customSubject === 'string';

    // Explicit user edits always take effect immediately (preventing browser/server clock skew issues).
    // Conditional initial hydration restores only apply if server has no newer state.
    const shouldApplyScheduleFields =
      body.isInitialRestore === true
        ? currentUpdatedAt === 0 || incomingUpdatedAt >= currentUpdatedAt
        : true;

    const nextUpdatedAt =
      hasScheduleFields && shouldApplyScheduleFields
        ? Math.max(incomingUpdatedAt, Date.now())
        : currentUpdatedAt;

    scheduleStore = {
      ...scheduleStore,
      recipients: mergedRecipients,
      ...(shouldApplyScheduleFields && typeof body.autoEnabled === 'boolean'
        ? { autoEnabled: body.autoEnabled }
        : {}),
      ...(shouldApplyScheduleFields && typeof body.triggerMode === 'string'
        ? { triggerMode: body.triggerMode }
        : {}),
      ...(shouldApplyScheduleFields && normalizedScheduledDays !== null
        ? { scheduledDays: normalizedScheduledDays }
        : {}),
      ...(shouldApplyScheduleFields && typeof body.includeEndOfMonth === 'boolean'
        ? { includeEndOfMonth: body.includeEndOfMonth }
        : {}),
      ...(shouldApplyScheduleFields && typeof body.scheduledTime === 'string'
        ? { scheduledTime: body.scheduledTime }
        : {}),
      ...(shouldApplyScheduleFields && typeof body.defaultEvPrice === 'string'
        ? { defaultEvPrice: body.defaultEvPrice }
        : {}),
      ...(shouldApplyScheduleFields && typeof body.customSubject === 'string'
        ? { customSubject: body.customSubject }
        : {}),
      ...(body.updateOverrides === true &&
      body.customOverrides &&
      typeof body.customOverrides === 'object'
        ? { customOverrides: body.customOverrides }
        : {}),
      sentLogs: mergedSentLogs.slice(0, 50),
      sentDateLocks: mergedDateLocks,
      updatedAt: nextUpdatedAt,
    };
    saveScheduleStore(scheduleStore);

    const todayIso = getThailandTodayIso();
    const sentTodayLog = getSentLogForDate(todayIso);

    res.json({
      success: true,
      publicTunnelUrl: publicTunnelUrl || readSavedTunnelUrl(),
      smtpConfigured: isSmtpConfigured(),
      smtpUser: process.env.SMTP_USER?.trim() || '',
      todayIsoBangkok: todayIso,
      sentToday: Boolean(sentTodayLog),
      sentTodayLog,
      config: scheduleStore,
    });
  });

  // 3a. Real-Time Server-Sent Events (SSE) Stream for Multi-Device Synchronization
  app.get('/api/realtime-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);

    const todayIso = getThailandTodayIso();
    const sentTodayLog = getSentLogForDate(todayIso);
    const initialPayload = JSON.stringify({
      type: 'state:sync',
      publicTunnelUrl: publicTunnelUrl || readSavedTunnelUrl(),
      smtpConfigured: isSmtpConfigured(),
      smtpUser: process.env.SMTP_USER?.trim() || '',
      todayIsoBangkok: todayIso,
      sentToday: Boolean(sentTodayLog),
      sentTodayLog,
      connectedClients: sseClients.size,
      config: scheduleStore,
    });
    res.write(`data: ${initialPayload}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // 3a-2. Update Cell Overrides or Default EV Price Across All Devices in Real Time
  app.post('/api/cell-overrides', (req, res) => {
    const body = req.body || {};
    if (body.customOverrides && typeof body.customOverrides === 'object') {
      scheduleStore = {
        ...scheduleStore,
        customOverrides: body.customOverrides,
      };
    }
    if (typeof body.defaultEvPrice === 'string') {
      scheduleStore = {
        ...scheduleStore,
        defaultEvPrice: body.defaultEvPrice,
      };
    }
    saveScheduleStore(scheduleStore);
    res.json({
      success: true,
      config: scheduleStore,
    });
  });

  // 3b. Explicitly Add Recipient Email(s) (Permanent until explicitly deleted)
  app.post('/api/recipients/add', (req, res) => {
    const incoming: string[] = Array.isArray(req.body?.emails)
      ? req.body.emails
      : typeof req.body?.email === 'string'
      ? [req.body.email]
      : [];

    const existingLower = new Set(scheduleStore.recipients.map((e) => e.toLowerCase()));
    const updated = [...scheduleStore.recipients];

    for (const raw of incoming) {
      const clean = String(raw || '').trim();
      if (clean && !existingLower.has(clean.toLowerCase())) {
        updated.push(clean);
        existingLower.add(clean.toLowerCase());
      }
    }

    scheduleStore = {
      ...scheduleStore,
      recipients: updated,
    };
    saveScheduleStore(scheduleStore);

    res.json({
      success: true,
      recipients: scheduleStore.recipients,
      config: scheduleStore,
    });
  });

  // 3c. Explicitly Delete a Single Recipient Email (ONLY way an email is removed)
  app.post('/api/recipients/remove', (req, res) => {
    const target = String(req.body?.email || '').trim().toLowerCase();
    if (!target) {
      res.status(400).json({ success: false, error: 'กรุณาระบุอีเมลที่ต้องการลบ' });
      return;
    }

    scheduleStore = {
      ...scheduleStore,
      recipients: scheduleStore.recipients.filter((e) => e.toLowerCase() !== target),
    };
    saveScheduleStore(scheduleStore);

    res.json({
      success: true,
      recipients: scheduleStore.recipients,
      config: scheduleStore,
    });
  });

  // 4. Trigger Immediate Server-Side SMTP Send (Protected by Daily Duplicate Lock)
  app.post('/api/send-server-email', async (req, res) => {
    try {
      const year = req.body?.year ? Number(req.body.year) : undefined;
      const month = req.body?.month ? Number(req.body.month) : undefined;
      const log = await sendServerSmtpEmail('manual', year, month);
      res.json({
        success: true,
        log,
        sentToday: true,
        sentTodayLog: log,
        config: scheduleStore,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'ไม่สามารถส่งอีเมลผ่านเซิร์ฟเวอร์ SMTP ได้';
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  });

  // 4b. Record Sent Email Log from Google Apps Script or External Sender
  app.post('/api/log-sent-email', (req, res) => {
    const body = req.body || {};
    const todayIso = getThailandTodayIso();
    const isoDateBangkok = body.isoDateBangkok || todayIso;
    const logId = body.id || `gas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newLog: SentEmailLog = {
      id: logId,
      sentAt: body.sentAt || new Date().toISOString(),
      isoDateBangkok,
      recipients: Array.isArray(body.recipients) && body.recipients.length > 0 ? body.recipients : scheduleStore.recipients,
      subject: body.subject || scheduleStore.customSubject,
      b10Price: typeof body.b10Price === 'number' ? body.b10Price : 43.54,
      triggerType: body.triggerType || 'auto_scheduled_date',
      channel: (body.channel as any) || 'server_smtp',
    };

    const existingLogs = scheduleStore.sentLogs || [];
    if (!existingLogs.some((l) => l.id === newLog.id || (l.isoDateBangkok === isoDateBangkok && l.channel === newLog.channel))) {
      const updatedLogs = [newLog, ...existingLogs].slice(0, 50);
      const updatedLocks = { ...(scheduleStore.sentDateLocks || {}), [isoDateBangkok]: newLog };
      scheduleStore = {
        ...scheduleStore,
        sentLogs: updatedLogs,
        sentDateLocks: updatedLocks,
        lastSentDateBangkok: isoDateBangkok,
      };
      saveScheduleStore(scheduleStore);
    }
    recordPermanentDateLock(isoDateBangkok, newLog);

    res.json({
      success: true,
      log: newLog,
      config: scheduleStore,
    });
  });

  // 5. External Cron / Google Apps Script Wake-Up & Check Endpoint
  app.get('/api/cron-wake', async (_req, res) => {
    await runBackgroundScheduleTick();
    const todayIso = getThailandTodayIso();
    const sentTodayLog = getSentLogForDate(todayIso);
    res.json({
      success: true,
      serverTimeBangkok: `${todayIso} ${getThailandNowTime()}`,
      sentToday: Boolean(sentTodayLog),
      sentTodayLog,
    });
  });

  // Background periodic schedule checker (ONLY checks during scheduled window, never immediately on boot)
  setInterval(() => {
    runBackgroundScheduleTick();
  }, 30000);

  // Ensure Public HTTPS Cloudflare Tunnel is running and monitored
  ensurePublicTunnel();
  setInterval(() => {
    const activeUrl = readSavedTunnelUrl();
    let isRunning = false;
    try {
      const pgrep = execSync('pgrep -f cloudflared || true', { encoding: 'utf-8' }).trim();
      if (pgrep) isRunning = true;
    } catch {}
    if (!isRunning || !activeUrl) {
      console.log('[Tunnel Watchdog] Restarting tunnel...');
      ensurePublicTunnel();
    }
  }, 30000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (publicTunnelUrl) {
      console.log(`[Public URL] App is publicly accessible at: ${publicTunnelUrl}`);
    }
  });
}

startServer();
