import React from 'react';

interface HighwayTrucksBannerProps {
  className?: string;
}

export const HighwayTrucksBanner: React.FC<HighwayTrucksBannerProps> = ({ className = '' }) => {
  return (
    <div
      className={`highway-track w-full h-16 sm:h-18 rounded-xl bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950 border border-slate-700/80 relative overflow-hidden select-none shadow-inner ${className}`}
      aria-label="แอนิเมชันจุดเติมน้ำมันดีเซล B10 และสถานีชาร์จไฟ EV พร้อมรถบรรทุกจอดเติมและชาร์จ"
    >
      {/* 1. Subtle Sky / Horizon Glow */}
      <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-sky-950/60 to-transparent pointer-events-none" />

      {/* 2. Top Road Shoulder Line */}
      <div className="absolute inset-x-0 top-0.5 h-[1px] bg-slate-600/40 pointer-events-none" />

      {/* 3. Center Dashed Road Divider Line (Yellow Thailand Highway Standard) */}
      <div
        className="absolute inset-x-0 top-[52%] h-[2px] opacity-60 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to right, #FACC15 0px, #FACC15 16px, transparent 16px, transparent 32px)',
        }}
      />

      {/* 4. Bottom Road Shoulder Line */}
      <div className="absolute inset-x-0 bottom-0.5 h-[1px] bg-slate-600/60 pointer-events-none" />

      {/* =========================================================================
          STATION 1: จุดเติมน้ำมัน ปตท. (PTT Station / ดีเซล B10)
          ตำแหน่ง: ประมาณ 30% ของถนน (เลนบน: รถ B10 วิ่งจากซ้ายไปขวา)
          ========================================================================= */}
      <div
        className="absolute top-0.5 left-[30%] -translate-x-1/2 pointer-events-none z-10 flex flex-col items-center"
        title="จุดเติมน้ำมัน ปตท. ดีเซล B10"
      >
        {/* PTT Station Overhead Canopy & Sign */}
        <div className="relative flex flex-col items-center">
          {/* Canopy Roof */}
          <div className="px-2.5 py-0.5 rounded-t bg-gradient-to-r from-[#1D3C85] via-[#2A5298] to-[#1D3C85] border-t border-x border-blue-400/60 shadow-md flex items-center gap-1">
            {/* Mini PTT Droplet */}
            <span className="inline-block w-2.5 h-3 rounded-full bg-gradient-to-br from-red-500 via-sky-400 to-blue-700 shadow-sm" />
            <span className="text-[9px] font-bold tracking-tight text-white font-sans uppercase">
              PTT STATION
            </span>
            <span className="text-[8px] font-black text-amber-300 bg-blue-950/80 px-1 py-0.2 rounded border border-amber-300/40">
              B10
            </span>
          </div>

          {/* Canopy Under-Light Beam */}
          <div className="w-full h-1 bg-gradient-to-b from-sky-400/50 to-transparent" />

          {/* Fuel Dispenser Pump & Pillar */}
          <div className="flex items-end justify-between w-full px-1.5 -mt-0.5">
            {/* Support Pillar Left */}
            <div className="w-1 h-5 bg-slate-600 rounded-sm" />

            {/* Gas Pump Dispenser Unit */}
            <div className="w-4 h-5 bg-gradient-to-b from-blue-700 to-slate-800 rounded border border-blue-400/50 flex flex-col items-center justify-between p-0.5 shadow">
              <div className="w-2.5 h-1.5 bg-black rounded-[1px] flex items-center justify-center">
                <span className="text-[6px] text-emerald-400 font-mono leading-none">43.54</span>
              </div>
              <div className="w-2.5 h-1 bg-amber-400 rounded-full" />
            </div>

            {/* Support Pillar Right */}
            <div className="w-1 h-5 bg-slate-600 rounded-sm" />
          </div>
        </div>
      </div>

      {/* =========================================================================
          STATION 2: สถานีชาร์จไฟ EV (EV Charging Station Plz)
          ตำแหน่ง: ประมาณ 70% ของถนน (เลนล่าง: รถ EV วิ่งจากขวาไปซ้าย)
          ========================================================================= */}
      <div
        className="absolute bottom-0.5 left-[70%] -translate-x-1/2 pointer-events-none z-10 flex flex-col items-center"
        title="สถานีชาร์จไฟ EV"
      >
        {/* EV Station Canopy & Sign */}
        <div className="relative flex flex-col items-center">
          {/* Charger Dispenser Tower & Pillars */}
          <div className="flex items-end justify-between w-full px-1.5 -mb-0.5">
            {/* Left Pillar */}
            <div className="w-1 h-5 bg-slate-600 rounded-sm" />

            {/* EV Fast Charger Unit */}
            <div className="w-4 h-5 bg-gradient-to-b from-emerald-600 to-slate-900 rounded border border-cyan-400/60 flex flex-col items-center justify-between p-0.5 shadow">
              <div className="w-2.5 h-1.5 bg-black rounded-[1px] flex items-center justify-center">
                <span className="text-[6px] text-cyan-300 font-mono leading-none">9.60</span>
              </div>
              <span className="text-[7px] text-cyan-300 leading-none">⚡</span>
            </div>

            {/* Right Pillar */}
            <div className="w-1 h-5 bg-slate-600 rounded-sm" />
          </div>

          {/* Under-Glow Light */}
          <div className="w-full h-1 bg-gradient-to-t from-cyan-400/40 to-transparent" />

          {/* Canopy Roof Bottom */}
          <div className="px-2.5 py-0.5 rounded-b bg-gradient-to-r from-emerald-900 via-teal-800 to-emerald-950 border-b border-x border-emerald-400/60 shadow-md flex items-center gap-1 station-glow">
            <span className="text-[8px] font-black text-cyan-300">⚡</span>
            <span className="text-[9px] font-bold tracking-tight text-emerald-200 font-sans uppercase">
              EV CHARGING
            </span>
            <span className="text-[8px] font-mono text-cyan-300 bg-black/60 px-1 py-0.2 rounded border border-cyan-400/40">
              9.60฿
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          TRUCK 1: PTT Diesel B10 Oil Tanker Truck (Driving Left -> Right)
          วิ่งมาถึงสถานี ปตท. (30%), จอดเติมน้ำมันสักครู่, แล้วเร่งเครื่องวิ่งต่อ
          ========================================================================= */}
      <div className="truck-drive-right absolute top-[2px] left-0 pointer-events-none z-20">
        <div className="relative">
          {/* Refueling Status Bubble (Pops up when stopped at PTT Station) */}
          <div className="refuel-badge-anim absolute -top-5 left-8 whitespace-nowrap bg-gradient-to-r from-blue-900 to-blue-950 text-amber-300 font-bold text-[9px] px-2 py-0.5 rounded-md shadow-lg border border-blue-400/80 flex items-center gap-1.5 z-30">
            <span className="animate-pulse">⛽</span>
            <span>กำลังเติมดีเซล B10...</span>
            <span className="font-mono text-white text-[8px] bg-blue-800 px-1 rounded">43.54฿</span>
          </div>

          {/* Truck Body with Gentle Engine Bounce */}
          <div className="truck-body-bounce">
            <svg
              width="118"
              height="34"
              viewBox="0 0 118 34"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Headlight Beam */}
              <polygon
                points="106,18 118,14 118,25"
                fill="url(#b10Headlight)"
                opacity="0.7"
              />
              <defs>
                <linearGradient id="b10Headlight" x1="106" y1="20" x2="118" y2="20" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#FEF08A" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#FEF08A" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="tankerSilver" x1="6" y1="4" x2="6" y2="23" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="55%" stopColor="#E2E8F0" />
                  <stop offset="100%" stopColor="#94A3B8" />
                </linearGradient>
              </defs>

              {/* Chassis */}
              <rect x="6" y="21" width="98" height="3.5" rx="1" fill="#334155" />

              {/* Cylindrical Oil Tanker Body */}
              <rect
                x="5"
                y="4.5"
                width="70"
                height="17"
                rx="8.5"
                fill="url(#tankerSilver)"
                stroke="#1D3C85"
                strokeWidth="1.2"
              />

              {/* PTT Blue & Cyan Racing Stripe on Tanker */}
              <rect x="9" y="16" width="62" height="2.2" rx="1" fill="#1D3C85" />
              <rect x="9" y="18.2" width="62" height="1.5" rx="0.75" fill="#00AEEF" />

              {/* Top Tanker Hatches */}
              <rect x="18" y="2.5" width="7" height="2" rx="1" fill="#64748B" />
              <rect x="37" y="2.5" width="7" height="2" rx="1" fill="#64748B" />
              <rect x="55" y="2.5" width="7" height="2" rx="1" fill="#64748B" />

              {/* PTT Mini Droplet Emblem on Tanker */}
              <g transform="translate(13, 6.2) scale(0.22)">
                <path
                  d="M18 1.5C18 1.5 3.5 18.2 3.5 29.5C3.5 37.5 10 44 18 44C26 44 32.5 37.5 32.5 29.5C32.5 18.2 18 1.5 18 1.5Z"
                  fill="#1D3C85"
                />
                <path
                  d="M18 9.5C18 9.5 8 21.8 8 30.2C8 35.7 12.5 40.2 18 40.2C23.5 40.2 28 35.7 28 30.2C28 21.8 18 9.5 18 9.5Z"
                  fill="#00AEEF"
                />
                <path
                  d="M18 18.5C18 18.5 12.2 26.2 12.2 31.4C12.2 34.6 14.8 37.2 18 37.2C21.2 37.2 23.8 34.6 23.8 31.4C23.8 26.2 18 18.5 18 18.5Z"
                  fill="#ED1C24"
                />
              </g>

              {/* "OIL B10 PTT" Text on Tanker */}
              <text
                x="23"
                y="14"
                fill="#1D3C85"
                fontFamily="Plus Jakarta Sans, Arial, sans-serif"
                fontWeight="800"
                fontSize="8.5"
                letterSpacing="0.3"
              >
                OIL B10 PTT
              </text>

              {/* Tractor Cab (PTT Navy Blue) */}
              <path
                d="M78 8C78 6.89543 78.8954 6 80 6H94.5C96.2 6 97.7 7.1 98.3 8.7L101.5 16L105 17.5C105.6 17.8 106 18.4 106 19.1V23.5H78V8Z"
                fill="#1D3C85"
              />
              {/* Cab Windshield */}
              <path d="M89 8.5H95.8L98.8 15H89V8.5Z" fill="#BAE6FD" />
              {/* Cab Side Window */}
              <rect x="81" y="8.5" width="6" height="6.5" rx="1" fill="#7DD3FC" />
              {/* Headlight */}
              <rect x="104.5" y="18.5" width="2" height="3" rx="0.5" fill="#FEF08A" />

              {/* Wheels */}
              {[16, 27, 63, 94].map((cx) => (
                <g key={cx}>
                  <circle cx={cx} cy="25.5" r="4.8" fill="#0F172A" stroke="#475569" strokeWidth="1" />
                  <circle cx={cx} cy="25.5" r="2.1" fill="#CBD5E1" />
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* =========================================================================
          TRUCK 2: EV Electric Logistics Truck (Driving Right -> Left)
          วิ่งมาถึงสถานีชาร์จ EV (70%), จอดชาร์จไฟสักครู่, แล้วเร่งเครื่องวิ่งต่อ
          ========================================================================= */}
      <div className="truck-drive-left absolute bottom-[2px] left-0 pointer-events-none z-20">
        <div className="relative">
          {/* Charging Status Bubble (Pops up when stopped at EV Station) */}
          <div className="charge-badge-anim absolute -top-5 right-8 whitespace-nowrap bg-gradient-to-r from-emerald-950 to-teal-950 text-cyan-300 font-bold text-[9px] px-2 py-0.5 rounded-md shadow-lg border border-cyan-400/80 flex items-center gap-1.5 z-30">
            <span className="animate-bounce">⚡</span>
            <span>กำลังชาร์จไฟ EV...</span>
            <span className="font-mono text-emerald-200 text-[8px] bg-emerald-900 px-1 rounded">9.60฿</span>
          </div>

          {/* EV Truck Body with Gentle Engine Bounce */}
          <div className="truck-body-bounce">
            <svg
              width="106"
              height="32"
              viewBox="0 0 106 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Cyan LED Headlight Beam (Facing Left) */}
              <polygon
                points="12,17 0,13 0,23"
                fill="url(#evHeadlight)"
                opacity="0.75"
              />
              <defs>
                <linearGradient id="evHeadlight" x1="12" y1="18" x2="0" y2="18" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#67E8F9" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#67E8F9" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="evBoxGrad" x1="34" y1="3" x2="100" y2="21" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ECFDF5" />
                  <stop offset="100%" stopColor="#D1FAE5" />
                </linearGradient>
              </defs>

              {/* Chassis */}
              <rect x="12" y="19.5" width="88" height="3" rx="1" fill="#064E3B" />

              {/* Aerodynamic EV Cab (Facing Left) */}
              <path
                d="M34 6.5C34 5.67157 33.3284 5 32.5 5H20.5C18.8 5 17.3 6 16.6 7.5L13.5 14.5L11.8 15.8C11.3 16.2 11 16.8 11 17.4V22H34V6.5Z"
                fill="#059669"
              />
              {/* EV Cab Windshield */}
              <path d="M23.5 7.5H18.5L15.5 14H23.5V7.5Z" fill="#A5F3FC" />
              {/* EV Cab Side Window */}
              <rect x="25.5" y="7.5" width="5.5" height="6.5" rx="1" fill="#67E8F9" />
              {/* Cyan LED Headlight */}
              <rect x="10.5" y="17" width="2" height="2.8" rx="0.5" fill="#67E8F9" />

              {/* EV Cargo Box Container */}
              <rect
                x="35"
                y="3.5"
                width="65"
                height="17"
                rx="2.5"
                fill="url(#evBoxGrad)"
                stroke="#059669"
                strokeWidth="1.2"
              />

              {/* Green & Cyan EV Stripe */}
              <rect x="36" y="16.5" width="63" height="2.2" fill="#10B981" />

              {/* Lightning Bolt Icon */}
              <path
                d="M45.5 6L41.5 11.2H45L43.8 15.2L48.5 9.6H45L45.5 6Z"
                fill="#059669"
              />

              {/* "EV TRUCK" Label */}
              <text
                x="51"
                y="13.5"
                fill="#065F46"
                fontFamily="Plus Jakarta Sans, Arial, sans-serif"
                fontWeight="800"
                fontSize="8.5"
                letterSpacing="0.4"
              >
                EV TRUCK
              </text>

              {/* Wheels */}
              {[20, 48, 86, 95].map((cx) => (
                <g key={cx}>
                  <circle cx={cx} cy="23.8" r="4.5" fill="#0F172A" stroke="#10B981" strokeWidth="1" />
                  <circle cx={cx} cy="23.8" r="1.9" fill="#A7F3D0" />
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
