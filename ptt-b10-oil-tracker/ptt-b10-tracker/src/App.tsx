import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  RotateCcw,
  Calendar,
  TrendingUp,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  X,
  Share2,
  Radio,
} from 'lucide-react';
import { PttLogoIcon } from './components/PttLogoIcon';
import { EmailAlertManager } from './components/EmailAlertManager';
import { HighwayTrucksBanner } from './components/HighwayTrucksBanner';
import {
  downloadPrintablePdf,
  downloadPrintablePng,
  triggerIframePrint,
} from './utils/sheetPrinter';
import {
  subscribeSharedBoardState,
  syncSharedBoardStateToFirestore,
} from './services/googleAuth';

interface DailyScheduleItem {
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

interface PriceChangePoint {
  isoDate: string;
  priceDateRaw: string;
  price: number;
  source: 'oilprice-board.aspx' | 'pttor-history';
}

interface LiveBoardData {
  sourceUrl: string;
  fetchedAt: string;
  effectiveText: string;
  effectiveIsoDate: string | null;
  effectiveTime: string | null;
  b10Price: number;
  b10Name: string;
  b10LogoUrl: string;
}

interface ApiResponse {
  success: boolean;
  sourceUrl: string;
  todayThailand: string;
  year: number;
  month: number;
  liveBoard: LiveBoardData;
  priceChanges: PriceChangePoint[];
  dailySchedule: DailyScheduleItem[];
  error?: string;
}

const THAI_MONTHS = [
  { value: 1, label: 'มกราคม (01)' },
  { value: 2, label: 'กุมภาพันธ์ (02)' },
  { value: 3, label: 'มีนาคม (03)' },
  { value: 4, label: 'เมษายน (04)' },
  { value: 5, label: 'พฤษภาคม (05)' },
  { value: 6, label: 'มิถุนายน (06)' },
  { value: 7, label: 'กรกฎาคม (07)' },
  { value: 8, label: 'สิงหาคม (08)' },
  { value: 9, label: 'กันยายน (09)' },
  { value: 10, label: 'ตุลาคม (10)' },
  { value: 11, label: 'พฤศจิกายน (11)' },
  { value: 12, label: 'ธันวาคม (12)' },
];

export default function App() {
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<number>(10);
  const [defaultEvPrice, setDefaultEvPrice] = useState<string>('9.60');
  const [highlightChanges, setHighlightChanges] = useState<boolean>(false);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState<'none' | 'excel' | 'tsv' | 'share_url'>('none');
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);
  const [connectedClients, setConnectedClients] = useState<number>(1);

  // Optional per-date manual overrides: key = isoDate (synced in real-time across all devices)
  const [customOverrides, setCustomOverrides] = useState<
    Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>
  >({});
  const [editingCell, setEditingCell] = useState<{
    isoDate: string;
    field: 'b10' | 'ev';
    value: string;
  } | null>(null);

  const [serverTunnelUrl, setServerTunnelUrl] = useState<string>('');

  // Public HTTPS URL that works on ANY device without AI Studio login / "Page not found" errors
  const sharedPublicUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (origin.includes('.trycloudflare.com')) {
        return origin;
      }
    }
    if (serverTunnelUrl && serverTunnelUrl.startsWith('https://')) {
      return serverTunnelUrl;
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }
    return '';
  }, [serverTunnelUrl]);

  // Hydrate shared state immediately on mount + subscribe to Server-Sent Events (/api/realtime-stream)
  useEffect(() => {
    fetch('/api/schedule-config')
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) {
          if (typeof res.publicTunnelUrl === 'string' && res.publicTunnelUrl) {
            setServerTunnelUrl(res.publicTunnelUrl);
          }
          if (res.config) {
            if (typeof res.config.defaultEvPrice === 'string') {
              setDefaultEvPrice(res.config.defaultEvPrice);
            }
            if (res.config.customOverrides && typeof res.config.customOverrides === 'object') {
              setCustomOverrides(res.config.customOverrides);
            }
          }
        }
      })
      .catch(() => {});

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/realtime-stream');
      es.onopen = () => {
        setRealtimeConnected(true);
      };
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'state:sync') {
            setRealtimeConnected(true);
            if (typeof payload.publicTunnelUrl === 'string' && payload.publicTunnelUrl) {
              setServerTunnelUrl(payload.publicTunnelUrl);
            }
            if (typeof payload.connectedClients === 'number') {
              setConnectedClients(Math.max(1, payload.connectedClients));
            }
            if (payload.config) {
              if (typeof payload.config.defaultEvPrice === 'string') {
                setDefaultEvPrice(payload.config.defaultEvPrice);
              }
              if (payload.config.customOverrides && typeof payload.config.customOverrides === 'object') {
                setCustomOverrides(payload.config.customOverrides);
              }
            }
          }
        } catch {
          // ignore parse error
        }
      };
      es.onerror = () => {
        setRealtimeConnected(false);
      };
    } catch {
      // fallback if EventSource is unavailable
    }

    const unsubFirestore = subscribeSharedBoardState((remote) => {
      if (remote.defaultEvPrice) {
        setDefaultEvPrice(remote.defaultEvPrice);
      }
    });

    return () => {
      if (es) es.close();
      unsubFirestore();
    };
  }, []);

  const fetchBoardData = useCallback(async (year: number, month: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ptt-b10?year=${year}&month=${month}`);
      const json: ApiResponse = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถดึงข้อมูลจาก http://www.pttor.com/oilprice-board.aspx ได้');
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoardData(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth, fetchBoardData]);

  const formattedDefaultEv = useMemo(() => {
    const parsed = parseFloat(defaultEvPrice);
    return Number.isNaN(parsed) ? '9.60' : parsed.toFixed(2);
  }, [defaultEvPrice]);

  // Compute displayed rows: always display prices up to the current date (!row.isFuture)
  const displayRows = useMemo(() => {
    if (!data?.dailySchedule) return [];

    return data.dailySchedule.map((row) => {
      const override = customOverrides[row.isoDate];

      let isRowPopulated = !row.isFuture;

      if (override?.forceBlank === true) {
        isRowPopulated = false;
      } else if (override?.forceBlank === false || override?.b10 !== undefined || override?.ev !== undefined) {
        isRowPopulated = true;
      }

      const b10Display = isRowPopulated
        ? override?.b10 !== undefined
          ? override.b10
          : row.b10Price.toFixed(2)
        : '';

      const evDisplay = isRowPopulated
        ? override?.ev !== undefined
          ? override.ev
          : formattedDefaultEv
        : '';

      return {
        ...row,
        isRowPopulated,
        b10Display,
        evDisplay,
      };
    });
  }, [data, customOverrides, formattedDefaultEv]);

  // Summary statistics for populated rows
  const stats = useMemo(() => {
    const populated = displayRows.filter((r) => r.b10Display !== '');
    if (populated.length === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, latest: data?.liveBoard.b10Price || 0 };
    }
    const values = populated.map((r) => parseFloat(r.b10Display)).filter((v) => !Number.isNaN(v));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    const latest = values[values.length - 1];
    return { count: values.length, min, max, avg, latest };
  }, [displayRows, data]);

  const buildExcelHtmlString = useCallback(() => {
    const rowsHtml = displayRows
      .map(
        (r) => `
      <tr style="height: 24px;">
        <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 11pt; mso-number-format:'\\@';">${r.dateFormatted}</td>
        <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 11pt; font-weight: bold; mso-number-format:'0\\.00';">${r.b10Display}</td>
        <td style="border: 1px solid #000000; text-align: center; font-family: Calibri, Arial, sans-serif; font-size: 11pt; font-weight: bold; mso-number-format:'0\\.00';">${r.evDisplay}</td>
      </tr>`
      )
      .join('');

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
      </head>
      <body>
        <table style="border-collapse: collapse; border: 1px solid #000000;">
          <thead>
            <tr style="height: 36px; background-color: #FFFF99; color: #0000FF; font-weight: bold; font-family: Calibri, Arial, sans-serif; font-size: 11pt;">
              <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; width: 115px; text-align: center;">Date</th>
              <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; width: 195px; text-align: center;">Fuel price B10 PTT</th>
              <th style="border: 1px solid #000000; background-color: #FFFF99; color: #0000FF; width: 110px; text-align: center;">EV price</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>`;
  }, [displayRows]);

  const handleCopyForExcel = async () => {
    const tsvLines = [
      ['Date', 'Fuel price B10 PTT', 'EV price'].join('\t'),
      ...displayRows.map((r) => [r.dateFormatted, r.b10Display, r.evDisplay].join('\t')),
    ];
    const tsvText = tsvLines.join('\n');
    const htmlContent = buildExcelHtmlString();

    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/plain': new Blob([tsvText], { type: 'text/plain' }),
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(tsvText);
      }
      setCopiedState('excel');
      setTimeout(() => setCopiedState('none'), 2500);
    } catch {
      await navigator.clipboard.writeText(tsvText);
      setCopiedState('excel');
      setTimeout(() => setCopiedState('none'), 2500);
    }
  };

  const handleDownloadExcel = () => {
    const htmlContent = buildExcelHtmlString();
    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const monthStr = String(selectedMonth).padStart(2, '0');
    a.href = url;
    a.download = `PTT_Fuel_Price_B10_${selectedYear}_${monthStr}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csvLines = [
      ['Date', 'Fuel price B10 PTT', 'EV price'].join(','),
      ...displayRows.map((r) => [r.dateFormatted, r.b10Display, r.evDisplay].join(',')),
    ];
    const blob = new Blob(['\ufeff' + csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const monthStr = String(selectedMonth).padStart(2, '0');
    a.href = url;
    a.download = `PTT_Fuel_Price_B10_${selectedYear}_${monthStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenPrintSheet = () => {
    setShowPrintModal(true);
    // Automatically generate & download the printable A4 PDF (with autoPrint instruction)
    // and trigger iframe print so printing works even inside a sandboxed preview iframe
    try {
      downloadPrintablePdf(displayRows, selectedYear, selectedMonth);
    } catch {
      // ignore if canvas fails
    }
    triggerIframePrint(buildExcelHtmlString());
  };

  const syncCellOverridesToServer = (
    nextOverrides: Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>,
    nextEvPrice?: string
  ) => {
    fetch('/api/cell-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customOverrides: nextOverrides,
        ...(typeof nextEvPrice === 'string' ? { defaultEvPrice: nextEvPrice } : {}),
      }),
    }).catch(() => {});
  };

  const handleDefaultEvPriceChange = (val: string) => {
    setDefaultEvPrice(val);
    fetch('/api/cell-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEvPrice: val }),
    }).catch(() => {});
    syncSharedBoardStateToFirestore({
      defaultEvPrice: val,
      selectedYear,
      selectedMonth,
    }).catch(() => {});
  };

  const handleResetOverrides = () => {
    setCustomOverrides({});
    syncCellOverridesToServer({});
  };

  const commitCellEdit = () => {
    if (!editingCell) return;
    const { isoDate, field, value } = editingCell;
    const trimmed = value.trim();

    setCustomOverrides((prev) => {
      const existing = prev[isoDate] || {};
      let nextMap: Record<string, { b10?: string; ev?: string; forceBlank?: boolean }>;
      if (trimmed === '') {
        nextMap = {
          ...prev,
          [isoDate]: { ...existing, forceBlank: true },
        };
      } else {
        const num = parseFloat(trimmed);
        const formatted = Number.isNaN(num) ? trimmed : num.toFixed(2);
        nextMap = {
          ...prev,
          [isoDate]: {
            ...existing,
            forceBlank: false,
            [field]: formatted,
          },
        };
      }
      syncCellOverridesToServer(nextMap);
      return nextMap;
    });
    setEditingCell(null);
  };

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(sharedPublicUrl);
      setCopiedState('share_url');
      setTimeout(() => setCopiedState('none'), 3000);
    } catch {
      // ignore
    }
  };

  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const handleDownloadZip = async () => {
    try {
      setIsDownloadingZip(true);
      const res = await fetch('/api/download-zip');
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ptt-b10-oil-tracker.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      window.location.href = '/api/download-zip';
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const hasOverrides = Object.keys(customOverrides).length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-4 sm:gap-6 px-4 sm:px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2.5 shrink-0">
          <a
            href="#sheet"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            PTT B10 Fuel &amp; EV Sheet
          </a>
          <span
            className={`hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
              realtimeConnected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
            title="ซิงก์ข้อมูลเรียลไทม์ตรงกันทุกเครื่อง"
          >
            <Radio className="w-3 h-3" />
            <span>Real-Time Sync</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isDownloadingZip}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 border border-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="ดาวน์โหลดไฟล์โค้ดทั้งหมด (ZIP) เพื่อนำไปอัปโหลดขึ้น GitHub สำหรับ Render"
          >
            <Download className={`w-3.5 h-3.5 text-emerald-700 ${isDownloadingZip ? 'animate-bounce' : ''}`} />
            <span>{isDownloadingZip ? 'กำลังเตรียมไฟล์...' : 'ดาวน์โหลดโค้ด (ZIP สำหรับ Render)'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyShareUrl}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title={`คัดลอกลิงก์สำหรับเปิดจากเครื่องอื่น (${sharedPublicUrl})`}
          >
            {copiedState === 'share_url' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">คัดลอกลิงก์แชร์แล้ว!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-[#1D3C85]" />
                <span>คัดลอกลิงก์เปิดทุกเครื่อง</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => fetchBoardData(selectedYear, selectedMonth)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#1D3C85] rounded-lg hover:bg-[#152C63] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>อัปเดตราคาล่าสุด</span>
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px max-w baseline) */}
      <main className="flex-1 w-full max-w-[1380px] mx-auto px-4 sm:px-6 py-6">
        {/* Control & Action Bar */}
        <section className="no-print mb-6 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          {/* Highway Trucks Animation & Public Share Link Strip */}
          <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Highway Trucks Animation Running in Opposite Directions */}
            <div className="w-full lg:max-w-xl xl:max-w-2xl shrink-0">
              <HighwayTrucksBanner className="w-full" />
            </div>

            {/* Public Link & Actions */}
            <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5 text-xs text-slate-700 flex-1">
              <div className="flex items-center gap-1.5 font-mono font-semibold text-[#1D3C85] break-all">
                <span className="text-slate-500 font-normal font-sans">ลิงก์เปิดทุกเครื่อง:</span>
                <a
                  href={sharedPublicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-blue-900"
                >
                  {sharedPublicUrl}
                </a>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyShareUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1D3C85] hover:bg-[#152C63] rounded-md transition-colors cursor-pointer"
                >
                  {copiedState === 'share_url' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>คัดลอกลิงก์แล้ว</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>คัดลอกลิงก์</span>
                    </>
                  )}
                </button>
                <a
                  href={sharedPublicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors"
                >
                  <span>เปิดลิงก์</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                ตารางอัปเดตราคาน้ำมันดีเซล B10 (Fuel price B10 PTT)
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>แหล่งข้อมูลโดยตรงจาก</span>
                <a
                  href="http://www.pttor.com/oilprice-board.aspx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[#1D3C85] underline hover:text-blue-900 inline-flex items-center gap-1"
                >
                  http://www.pttor.com/oilprice-board.aspx
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span aria-hidden="true">·</span>
                <span>เฉพาะน้ำมันดีเซล (Diesel B10)</span>
                {data?.liveBoard?.effectiveText && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-800">
                      {data.liveBoard.effectiveText}
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Primary Export / Copy Actions */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleCopyForExcel}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedState === 'excel' ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>คัดลอกตารางแล้ว (วางใน Excel ได้เลย)</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>คัดลอกตารางลง Excel</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadExcel}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                <span>ดาวน์โหลด .XLS</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-600" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handleOpenPrintSheet}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="พิมพ์ตาราง / ดาวน์โหลดไฟล์ PDF สำหรับพิมพ์"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                <span>พิมพ์</span>
              </button>
            </div>
          </div>

          {/* Filter & Formatting Controls */}
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            {/* Month Picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ประจำเดือน (Month)
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
              >
                {THAI_MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Year Picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ปี ค.ศ. (Year)
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D3C85] tabular-nums"
              >
                <option value={2026}>2026 (พ.ศ. 2569)</option>
                <option value={2025}>2025 (พ.ศ. 2568)</option>
                <option value={2024}>2024 (พ.ศ. 2567)</option>
              </select>
            </div>

            {/* Default EV Price */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ค่าเริ่มต้น EV price
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={defaultEvPrice}
                  onChange={(e) => handleDefaultEvPriceChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono font-semibold bg-white border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1D3C85]"
                />
                {hasOverrides && (
                  <button
                    type="button"
                    onClick={handleResetOverrides}
                    title="รีเซ็ตค่าที่แก้ไขด้วยตนเอง"
                    className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>รีเซ็ต</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Error Banner if any */}
        {error && (
          <div className="no-print mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-4 text-red-900">
            <div className="flex items-center gap-3 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchBoardData(selectedYear, selectedMonth)}
              className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              ลองอีกครั้ง
            </button>
          </div>
        )}

        {/* Workspace 2-Column Split: Left = Exact Excel Table Format, Right = Live PTT OR Board & History */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Exact Formatted Spreadsheet */}
          <div id="sheet" className="lg:col-span-7 flex flex-col items-center">
            <div className="w-full bg-white border border-slate-200 rounded-xl p-4 sm:p-6 print-only-sheet flex flex-col items-center">
              <div className="no-print w-full max-w-[460px] flex items-center justify-between mb-3 text-xs text-slate-500">
                <span>คลิกที่ช่องราคาเพื่อแก้ไขรายวันได้โดยตรง</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={highlightChanges}
                    onChange={(e) => setHighlightChanges(e.target.checked)}
                    className="rounded border-slate-300 text-[#1D3C85] focus:ring-[#1D3C85]"
                  />
                  <span>ไฮไลต์วันที่มีการปรับราคา</span>
                </label>
              </div>

              {/* THE EXACT EXCEL FORMAT TABLE FROM THE ATTACHED IMAGE */}
              <div className="overflow-x-auto w-full flex justify-center">
                <table className="excel-sheet-table w-full max-w-[460px] text-[15px] leading-tight">
                  <thead>
                    <tr className="h-[46px]">
                      <th className="excel-header-cell w-[124px] px-2 text-[15px] tracking-normal">
                        Date
                      </th>
                      <th
                        className="excel-header-cell excel-comment-indicator w-[212px] px-2 text-[15px] tracking-normal group"
                        title="ข้อมูลจาก http://www.pttor.com/oilprice-board.aspx (เฉพาะราคาน้ำมันดีเซล B10)"
                      >
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <PttLogoIcon className="w-[18px] h-[23px] shrink-0" />
                          <span>Fuel price B10 PTT</span>
                        </div>
                      </th>
                      <th className="excel-header-cell w-[118px] px-2 text-[15px] tracking-normal">
                        EV price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !data
                      ? Array.from({ length: 31 }).map((_, idx) => {
                          const d = String(idx + 1).padStart(2, '0');
                          const m = String(selectedMonth).padStart(2, '0');
                          return (
                            <tr key={idx} className="h-[31px]">
                              <td className="text-center font-normal text-black tabular-nums px-2">
                                {d}/{m}/{selectedYear}
                              </td>
                              <td className="text-center px-2">
                                <div className="h-4 w-14 mx-auto bg-slate-100 animate-pulse rounded" />
                              </td>
                              <td className="text-center px-2">
                                <div className="h-4 w-10 mx-auto bg-slate-100 animate-pulse rounded" />
                              </td>
                            </tr>
                          );
                        })
                      : displayRows.map((row) => {
                          const isEditingB10 =
                            editingCell?.isoDate === row.isoDate && editingCell.field === 'b10';
                          const isEditingEv =
                            editingCell?.isoDate === row.isoDate && editingCell.field === 'ev';

                          const rowBgClass =
                            highlightChanges && row.isChangeDay && row.isRowPopulated
                              ? 'bg-amber-50/70'
                              : 'bg-white hover:bg-slate-50/80';

                          return (
                            <tr key={row.isoDate} className={`h-[31px] transition-colors ${rowBgClass}`}>
                              {/* Column 1: Date (DD/MM/YYYY) */}
                              <td className="text-center font-normal text-black tabular-nums px-2">
                                {row.dateFormatted}
                              </td>

                              {/* Column 2: Fuel price B10 PTT */}
                              <td
                                onClick={() => {
                                  if (!isEditingB10) {
                                    setEditingCell({
                                      isoDate: row.isoDate,
                                      field: 'b10',
                                      value: row.b10Display || row.b10Price.toFixed(2),
                                    });
                                  }
                                }}
                                className="text-center font-bold text-black tabular-nums px-2 cursor-pointer"
                                title={
                                  row.isChangeDay
                                    ? `ปรับราคาเมื่อ ${row.effectiveFrom} (${
                                        row.priceDelta > 0
                                          ? `+${row.priceDelta.toFixed(2)}`
                                          : row.priceDelta.toFixed(2)
                                      })`
                                    : 'คลิกเพื่อแก้ไขราคา'
                                }
                              >
                                {isEditingB10 ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingCell.value}
                                    onChange={(e) =>
                                      setEditingCell({ ...editingCell, value: e.target.value })
                                    }
                                    onBlur={commitCellEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitCellEdit();
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-20 text-center font-bold bg-yellow-50 border border-blue-600 rounded px-1 py-0 text-[15px] focus:outline-none"
                                  />
                                ) : (
                                  <span>{row.b10Display}</span>
                                )}
                              </td>

                              {/* Column 3: EV price */}
                              <td
                                onClick={() => {
                                  if (!isEditingEv) {
                                    setEditingCell({
                                      isoDate: row.isoDate,
                                      field: 'ev',
                                      value: row.evDisplay || formattedDefaultEv,
                                    });
                                  }
                                }}
                                className="text-center font-bold text-black tabular-nums px-2 cursor-pointer"
                                title="คลิกเพื่อแก้ไข EV price"
                              >
                                {isEditingEv ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingCell.value}
                                    onChange={(e) =>
                                      setEditingCell({ ...editingCell, value: e.target.value })
                                    }
                                    onBlur={commitCellEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitCellEdit();
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-16 text-center font-bold bg-yellow-50 border border-blue-600 rounded px-1 py-0 text-[15px] focus:outline-none"
                                  />
                                ) : (
                                  <span>{row.evDisplay}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Live Board Telemetry, Monthly Price Adjustment History & Automated Email Alerts */}
          <div className="no-print lg:col-span-5 flex flex-col gap-6">
            {/* Live Board Status from http://www.pttor.com/oilprice-board.aspx */}
            <section
              id="live-source"
              className="bg-white border border-slate-200 rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    สถานะราคาล่าสุดจากกระดาน PTT OR
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ดึงข้อมูลสดจาก http://www.pttor.com/oilprice-board.aspx
                  </p>
                </div>
                <a
                  href="http://www.pttor.com/oilprice-board.aspx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D3C85] hover:underline whitespace-nowrap shrink-0"
                >
                  <span>เปิดลิงก์ต้นทาง</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Current B10 Price Highlight */}
              <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-12 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <PttLogoIcon className="w-6 h-8" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-medium">
                      น้ำมันดีเซลหมุนเร็ว (Diesel B10)
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      Fuel price B10 PTT
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {data?.liveBoard?.effectiveText || 'กำลังตรวจสอบเวลาปรับราคา...'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#1D3C85]">
                    {data?.liveBoard?.b10Price ? data.liveBoard.b10Price.toFixed(2) : '—'}
                  </div>
                  <div className="text-xs text-slate-500">บาท / ลิตร</div>
                </div>
              </div>

              {/* Monthly KPI Summary Grid */}
              <div className="mt-4 grid grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70">
                  <div className="text-xs text-slate-500">ราคาต่ำสุดเดือนนี้</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                    {stats.count > 0 ? stats.min.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70">
                  <div className="text-xs text-slate-500">ราคาสูงสุดเดือนนี้</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                    {stats.count > 0 ? stats.max.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70">
                  <div className="text-xs text-slate-500">ค่าเฉลี่ย ({stats.count} วัน)</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                    {stats.count > 0 ? stats.avg.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
            </section>

            {/* Price Adjustment Timeline for Diesel B10 */}
            <section
              id="price-history"
              className="bg-white border border-slate-200 rounded-xl p-5"
            >
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[#1D3C85]" />
                    <span>รอบการปรับราคาดีเซล B10 ({selectedYear})</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    มีผลบังคับใช้เวลา 05:00 น. ของวันที่ประกาศ
                  </p>
                </div>
              </div>

              <div className="mt-3 divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
                {data?.priceChanges && data.priceChanges.length > 0 ? (
                  [...data.priceChanges]
                    .reverse()
                    .slice(0, 12)
                    .map((change, idx, arr) => {
                      const prev = arr[idx + 1];
                      const diff = prev ? Number((change.price - prev.price).toFixed(2)) : 0;
                      const [y, m, d] = change.isoDate.split('-');
                      return (
                        <div
                          key={change.isoDate}
                          className="py-2.5 flex items-center justify-between text-xs sm:text-sm"
                        >
                          <div className="flex items-center gap-2.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <div>
                              <span className="font-medium text-slate-900 tabular-nums">
                                {d}/{m}/{y}
                              </span>
                              <span className="text-slate-400 mx-1.5">·</span>
                              <span className="text-xs text-slate-500">05:00 น.</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 tabular-nums font-mono">
                            {diff !== 0 && (
                              <span
                                className={`text-xs font-medium ${
                                  diff > 0 ? 'text-red-600' : 'text-emerald-600'
                                }`}
                              >
                                {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                              </span>
                            )}
                            <span className="font-bold text-slate-900 text-sm">
                              {change.price.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <div className="py-6 text-center text-xs text-slate-500">
                    กำลังโหลดประวัติการปรับราคา...
                  </div>
                )}
              </div>
            </section>

            {/* Automated Server-Side Cron + SMTP / Gmail Notification Manager */}
            <EmailAlertManager
              year={selectedYear}
              month={selectedMonth}
              todayThailand={data?.todayThailand || '2026-10-20'}
              effectiveText={data?.liveBoard?.effectiveText || ''}
              latestB10Price={data?.liveBoard?.b10Price || 0}
              defaultEvPrice={defaultEvPrice}
              customOverrides={customOverrides}
              displayRows={displayRows}
              publicTunnelUrl={sharedPublicUrl}
            />
          </div>
        </div>
      </main>

      {/* Print Preview & Printable PDF Export Modal */}
      {showPrintModal && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={() => setShowPrintModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Printer className="w-4 h-4 text-[#1D3C85]" />
                  <span>
                    พิมพ์ตารางราคาน้ำมันดีเซล B10 ({String(selectedMonth).padStart(2, '0')}/
                    {selectedYear})
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ระบบได้สร้างไฟล์ PDF ขนาด A4 สำหรับสั่งพิมพ์ให้แล้ว หรือเลือกวิธีพิมพ์ด้านล่างได้เลย
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Print Action Buttons */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadPrintablePdf(displayRows, selectedYear, selectedMonth)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1D3C85] hover:bg-[#152C63] rounded-lg transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>ดาวน์โหลดไฟล์พิมพ์ .PDF (A4 คมชัดสูง)</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadPrintablePng(displayRows, selectedYear, selectedMonth)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-700" />
                  <span>บันทึกรูปตาราง (.PNG)</span>
                </button>

                <button
                  type="button"
                  onClick={() => triggerIframePrint(buildExcelHtmlString())}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  <span>สั่งพิมพ์หน้าต่างเบราว์เซอร์</span>
                </button>
              </div>
            </div>

            {/* Live Printable Sheet Preview */}
            <div className="p-6 overflow-y-auto flex flex-col items-center bg-slate-100/80">
              <div className="bg-white p-6 shadow-sm border border-slate-300 flex justify-center">
                <table className="excel-sheet-table w-[454px] text-[15px] leading-tight">
                  <thead>
                    <tr className="h-[46px]">
                      <th className="excel-header-cell w-[124px] px-2 text-[15px]">Date</th>
                      <th className="excel-header-cell excel-comment-indicator w-[212px] px-2 text-[15px]">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <PttLogoIcon className="w-[18px] h-[23px] shrink-0" />
                          <span>Fuel price B10 PTT</span>
                        </div>
                      </th>
                      <th className="excel-header-cell w-[118px] px-2 text-[15px]">EV price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => (
                      <tr key={row.isoDate} className="h-[30px] bg-white">
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
        </div>
      )}
    </div>
  );
}
