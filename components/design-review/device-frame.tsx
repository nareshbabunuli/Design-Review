"use client"

import React from "react"
import { Monitor, Smartphone, Tablet, Laptop, Wifi } from "lucide-react"

// ============================================================================
// Types
// ============================================================================

export type DeviceFrameType =
  | "iphone-dynamic-island"
  | "iphone-notch"
  | "iphone-classic"
  | "samsung-ultra"
  | "samsung-modern"
  | "samsung-classic"
  | "pixel-modern"
  | "pixel-classic"
  | "ipad-pro"
  | "ipad-classic"
  | "macbook-pro"
  | "desktop-monitor"
  | "none"

export type FrameFinish = "titanium" | "silver" | "gold" | "midnight"

export interface DevicePresetExtended {
  id: string
  category: "Mobile" | "Tablet" | "Laptop" | "Desktop"
  group: "Latest Flagships" | "Notch Era" | "Old & Classic Phones" | "Tablets" | "Laptops" | "Desktops"
  name: string
  width: number
  height: number
  frameType: DeviceFrameType
  icon: React.ComponentType<{ className?: string }>
}

// ============================================================================
// Presets: Latest phones, Notch era, Classic/Old phones, Tablets, Laptops & Desktops
// ============================================================================

export const EXTENDED_DEVICE_PRESETS: DevicePresetExtended[] = [
  // --- Mobile: Latest Flagships (Dynamic Island & Modern Punch-Hole) ---
  {
    id: "m-iphone-16-pro-max",
    category: "Mobile",
    group: "Latest Flagships",
    name: "iPhone 16 Pro Max",
    width: 430,
    height: 932,
    frameType: "iphone-dynamic-island",
    icon: Smartphone,
  },
  {
    id: "m-iphone-16-pro",
    category: "Mobile",
    group: "Latest Flagships",
    name: "iPhone 16 Pro / 15 Pro",
    width: 393,
    height: 852,
    frameType: "iphone-dynamic-island",
    icon: Smartphone,
  },
  {
    id: "m-iphone-15",
    category: "Mobile",
    group: "Latest Flagships",
    name: "iPhone 15 / 15 Plus",
    width: 390,
    height: 844,
    frameType: "iphone-dynamic-island",
    icon: Smartphone,
  },
  {
    id: "m-s24-ultra",
    category: "Mobile",
    group: "Latest Flagships",
    name: "Samsung Galaxy S24 Ultra",
    width: 412,
    height: 915,
    frameType: "samsung-ultra",
    icon: Smartphone,
  },
  {
    id: "m-s24",
    category: "Mobile",
    group: "Latest Flagships",
    name: "Samsung Galaxy S24 / S23",
    width: 360,
    height: 780,
    frameType: "samsung-modern",
    icon: Smartphone,
  },
  {
    id: "m-pixel-9",
    category: "Mobile",
    group: "Latest Flagships",
    name: "Google Pixel 9 Pro / 8 Pro",
    width: 412,
    height: 923,
    frameType: "pixel-modern",
    icon: Smartphone,
  },

  // --- Mobile: Notch Era (iPhone X through 14) ---
  {
    id: "m-iphone-14",
    category: "Mobile",
    group: "Notch Era",
    name: "iPhone 14 / 13 Pro (Notch)",
    width: 390,
    height: 844,
    frameType: "iphone-notch",
    icon: Smartphone,
  },
  {
    id: "m-iphone-13-mini",
    category: "Mobile",
    group: "Notch Era",
    name: "iPhone 13 / 12 Mini",
    width: 375,
    height: 812,
    frameType: "iphone-notch",
    icon: Smartphone,
  },
  {
    id: "m-iphone-x",
    category: "Mobile",
    group: "Notch Era",
    name: "iPhone X / XS / 11 Pro",
    width: 375,
    height: 812,
    frameType: "iphone-notch",
    icon: Smartphone,
  },

  // --- Mobile: Old & Classic Phones (Home Button, Thick Bezels, Forehead & Chin) ---
  {
    id: "m-iphone-se",
    category: "Mobile",
    group: "Old & Classic Phones",
    name: "iPhone SE (2nd/3rd) / iPhone 8",
    width: 375,
    height: 667,
    frameType: "iphone-classic",
    icon: Smartphone,
  },
  {
    id: "m-iphone-8-plus",
    category: "Mobile",
    group: "Old & Classic Phones",
    name: "iPhone 8 Plus / 7 Plus",
    width: 414,
    height: 736,
    frameType: "iphone-classic",
    icon: Smartphone,
  },
  {
    id: "m-iphone-5s",
    category: "Mobile",
    group: "Old & Classic Phones",
    name: "iPhone 5S / SE 1st Gen (4-inch)",
    width: 320,
    height: 568,
    frameType: "iphone-classic",
    icon: Smartphone,
  },
  {
    id: "m-galaxy-s8",
    category: "Mobile",
    group: "Old & Classic Phones",
    name: "Samsung Galaxy S8 / S9",
    width: 360,
    height: 740,
    frameType: "samsung-classic",
    icon: Smartphone,
  },
  {
    id: "m-pixel-2",
    category: "Mobile",
    group: "Old & Classic Phones",
    name: "Google Pixel 2 (Dual Front Speakers)",
    width: 411,
    height: 731,
    frameType: "pixel-classic",
    icon: Smartphone,
  },

  // --- Tablets ---
  {
    id: "t-ipad-pro-12",
    category: "Tablet",
    group: "Tablets",
    name: 'iPad Pro 12.9" (Liquid Retina)',
    width: 1024,
    height: 1366,
    frameType: "ipad-pro",
    icon: Tablet,
  },
  {
    id: "t-ipad-air",
    category: "Tablet",
    group: "Tablets",
    name: 'iPad Air 11"',
    width: 820,
    height: 1180,
    frameType: "ipad-pro",
    icon: Tablet,
  },
  {
    id: "t-ipad-classic",
    category: "Tablet",
    group: "Tablets",
    name: 'iPad Classic 10.2" (Home Button)',
    width: 768,
    height: 1024,
    frameType: "ipad-classic",
    icon: Tablet,
  },
  {
    id: "t-ipad-mini",
    category: "Tablet",
    group: "Tablets",
    name: "iPad Mini 6",
    width: 744,
    height: 1133,
    frameType: "ipad-pro",
    icon: Tablet,
  },

  // --- Laptops ---
  {
    id: "l-macbook-16",
    category: "Laptop",
    group: "Laptops",
    name: 'MacBook Pro 16" (M3/M4)',
    width: 1728,
    height: 1117,
    frameType: "macbook-pro",
    icon: Laptop,
  },
  {
    id: "l-macbook-14",
    category: "Laptop",
    group: "Laptops",
    name: 'MacBook Pro 14"',
    width: 1512,
    height: 982,
    frameType: "macbook-pro",
    icon: Laptop,
  },
  {
    id: "l-macbook-air",
    category: "Laptop",
    group: "Laptops",
    name: 'MacBook Air 13"',
    width: 1280,
    height: 832,
    frameType: "macbook-pro",
    icon: Laptop,
  },

  // --- Desktops ---
  {
    id: "d-studio-27",
    category: "Desktop",
    group: "Desktops",
    name: 'Apple Studio Display 27"',
    width: 1440,
    height: 900,
    frameType: "desktop-monitor",
    icon: Monitor,
  },
  {
    id: "d-desktop-1080",
    category: "Desktop",
    group: "Desktops",
    name: "Desktop 1080p (1920 × 1080)",
    width: 1920,
    height: 1080,
    frameType: "desktop-monitor",
    icon: Monitor,
  },
  {
    id: "d-desktop-compact",
    category: "Desktop",
    group: "Desktops",
    name: "Desktop Compact (1024 × 768)",
    width: 1024,
    height: 768,
    frameType: "desktop-monitor",
    icon: Monitor,
  },
]

// ============================================================================
// Frame Metrics Calculation Helper
// ============================================================================

export function getDeviceFrameMetrics(
  frameType: DeviceFrameType,
  width: number,
  height: number,
  showFrame: boolean
) {
  if (!showFrame || frameType === "none") {
    return {
      padTop: 0,
      padBottom: 0,
      padLeft: 0,
      padRight: 0,
      totalWidth: width,
      totalHeight: height,
    }
  }

  switch (frameType) {
    case "iphone-dynamic-island":
    case "iphone-notch":
      return {
        padTop: 12,
        padBottom: 12,
        padLeft: 12,
        padRight: 12,
        totalWidth: width + 24,
        totalHeight: height + 24,
      }

    case "iphone-classic":
      // Forehead 60px with speaker & camera, chin 68px with circular Touch ID home button
      return {
        padTop: 60,
        padBottom: 68,
        padLeft: 14,
        padRight: 14,
        totalWidth: width + 28,
        totalHeight: height + 128,
      }

    case "samsung-ultra":
      // Boxy sharp titanium frame
      return {
        padTop: 8,
        padBottom: 8,
        padLeft: 8,
        padRight: 8,
        totalWidth: width + 16,
        totalHeight: height + 16,
      }

    case "samsung-modern":
    case "pixel-modern":
      return {
        padTop: 10,
        padBottom: 10,
        padLeft: 10,
        padRight: 10,
        totalWidth: width + 20,
        totalHeight: height + 20,
      }

    case "samsung-classic":
    case "pixel-classic":
      // Slim forehead with speaker/camera, slim chin
      return {
        padTop: 44,
        padBottom: 44,
        padLeft: 12,
        padRight: 12,
        totalWidth: width + 24,
        totalHeight: height + 88,
      }

    case "ipad-pro":
      return {
        padTop: 16,
        padBottom: 16,
        padLeft: 16,
        padRight: 16,
        totalWidth: width + 32,
        totalHeight: height + 32,
      }

    case "ipad-classic":
      // Classic iPad with Touch ID button on bottom
      return {
        padTop: 52,
        padBottom: 60,
        padLeft: 32,
        padRight: 32,
        totalWidth: width + 64,
        totalHeight: height + 112,
      }

    case "macbook-pro":
      // Display lid top, bottom hinge and keyboard base
      return {
        padTop: 16,
        padBottom: 24,
        padLeft: 16,
        padRight: 16,
        totalWidth: width + 32,
        totalHeight: height + 40,
      }

    case "desktop-monitor":
      // Monitor bezel top/sides, bottom chin, stand neck & base
      return {
        padTop: 12,
        padBottom: 90, // Includes neck and base plate
        padLeft: 12,
        padRight: 12,
        totalWidth: width + 24,
        totalHeight: height + 102,
      }

    default:
      return {
        padTop: 0,
        padBottom: 0,
        padLeft: 0,
        padRight: 0,
        totalWidth: width,
        totalHeight: height,
      }
  }
}

// ============================================================================
// Color Finish Styles
// ============================================================================

const FINISH_BORDER_STYLES: Record<FrameFinish, { chassis: string; rim: string; button: string }> = {
  titanium: {
    chassis: "bg-[#181a20] border-[#363a48]",
    rim: "ring-1 ring-white/10 shadow-[0_0_0_2px_#272a35,0_0_0_4px_#181a22]",
    button: "bg-[#323642] border-[#444a5b]",
  },
  silver: {
    chassis: "bg-[#252830] border-[#8a91a0]",
    rim: "ring-1 ring-white/25 shadow-[0_0_0_2px_#7c8392,0_0_0_4px_#3f434d]",
    button: "bg-[#8f96a4] border-[#a5adbb]",
  },
  gold: {
    chassis: "bg-[#201d19] border-[#7d6b4f]",
    rim: "ring-1 ring-[#e6c99c]/20 shadow-[0_0_0_2px_#6f5e43,0_0_0_4px_#2c251a]",
    button: "bg-[#8a7657] border-[#bda277]",
  },
  midnight: {
    chassis: "bg-[#0b0d13] border-[#1f2433]",
    rim: "ring-1 ring-blue-400/10 shadow-[0_0_0_2px_#181c28,0_0_0_4px_#0b0d13]",
    button: "bg-[#1e2332] border-[#2d344b]",
  },
}

// ============================================================================
// Props
// ============================================================================

export interface DeviceFrameProps {
  frameType: DeviceFrameType
  finish?: FrameFinish
  width: number
  height: number
  scale?: number
  showFrame?: boolean
  showStatusBar?: boolean
  screenRef?: React.Ref<HTMLDivElement>
  className?: string
  children: React.ReactNode
}

// ============================================================================
// Main Component
// ============================================================================

export function DeviceFrame({
  frameType,
  finish = "titanium",
  width,
  height,
  scale = 1,
  showFrame = true,
  showStatusBar = true,
  screenRef,
  className = "",
  children,
}: DeviceFrameProps) {
  const metrics = getDeviceFrameMetrics(frameType, width, height, showFrame)
  const finishStyle = FINISH_BORDER_STYLES[finish] || FINISH_BORDER_STYLES.titanium

  // Raw viewport when frame is disabled
  if (!showFrame || frameType === "none") {
    return (
      <div
        style={{ width: `${width * scale}px`, height: `${height * scale}px` }}
        className={`relative shrink-0 transition-all duration-150 ${className}`}
      >
        <div
          ref={screenRef}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          className="shadow-xl shadow-slate-300/60 dark:shadow-2xl dark:shadow-black/80 rounded-2xl overflow-hidden border border-slate-300 dark:border-[#2b3040] bg-white dark:bg-[#0f1117] flex flex-col relative"
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: `${metrics.totalWidth * scale}px`,
        height: `${metrics.totalHeight * scale}px`,
      }}
      className={`relative shrink-0 transition-all duration-150 select-none ${className}`}
    >
      <div
        style={{
          width: `${metrics.totalWidth}px`,
          height: `${metrics.totalHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
        className="relative"
      >
        {/* ================================================================ */}
        {/* 1. iPHONE: DYNAMIC ISLAND (iPhone 16 Pro Max, 16 Pro, 15 Pro, 15) */}
        {/* ================================================================ */}
        {frameType === "iphone-dynamic-island" && (
          <div
            className={`relative w-full h-full rounded-[54px] p-[12px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_40px_rgba(0,0,0,0.6)] flex flex-col`}
          >
            {/* Left Buttons: Action Button + Volume Up + Volume Down */}
            <div className={`absolute -left-[3px] top-[108px] w-[3px] h-[26px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[148px] w-[3px] h-[48px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[208px] w-[3px] h-[48px] rounded-l-sm ${finishStyle.button}`} />

            {/* Right Button: Power / Siri Button */}
            <div className={`absolute -right-[3px] top-[160px] w-[3px] h-[72px] rounded-r-sm ${finishStyle.button}`} />

            {/* Display Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[44px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Dynamic Island Pill */}
              <div className="absolute top-[10px] left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center justify-between px-3 w-[122px] h-[33px] bg-black rounded-full shadow-[0_0_6px_rgba(0,0,0,0.9)] border border-black/80">
                {/* Front Camera Lens Specular Highlight */}
                <div className="w-2.5 h-2.5 rounded-full bg-[#080d19] ring-1 ring-[#161f33] flex items-center justify-center">
                  <div className="w-1 h-1 rounded-full bg-[#1b2b52]" />
                </div>
                {/* Sensor indicator dot */}
                <div className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
              </div>

              {/* Status Bar Overlay (Clock & Icons) */}
              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-10 px-7 z-20 pointer-events-none flex items-center justify-between text-white text-[12px] font-semibold tracking-tight">
                  <span className="font-mono text-[11px] pt-0.5">9:41</span>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div className="flex items-end gap-0.5 h-2.5">
                      <div className="w-0.5 h-1 bg-white rounded-xs" />
                      <div className="w-0.5 h-1.5 bg-white rounded-xs" />
                      <div className="w-0.5 h-2 bg-white rounded-xs" />
                      <div className="w-0.5 h-2.5 bg-white rounded-xs" />
                    </div>
                    <Wifi className="w-3 h-3 stroke-[2.5]" />
                    {/* Battery Pill */}
                    <div className="w-5 h-2.5 rounded-[3px] border border-white/70 p-0.5 flex items-center">
                      <div className="w-full h-full bg-emerald-400 rounded-[1px]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Screen Children Content */}
              <div className="w-full h-full relative overflow-hidden">{children}</div>

              {/* iOS Home Indicator Bar */}
              <div className="absolute bottom-[8px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[134px] h-[4px] bg-white/70 hover:bg-white rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 2. iPHONE: CLASSIC NOTCH (iPhone 14, 13, 12, X, XS, 11)        */}
        {/* ================================================================ */}
        {frameType === "iphone-notch" && (
          <div
            className={`relative w-full h-full rounded-[50px] p-[12px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_40px_rgba(0,0,0,0.6)] flex flex-col`}
          >
            {/* Buttons */}
            <div className={`absolute -left-[3px] top-[108px] w-[3px] h-[22px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[148px] w-[3px] h-[46px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[206px] w-[3px] h-[46px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -right-[3px] top-[160px] w-[3px] h-[68px] rounded-r-sm ${finishStyle.button}`} />

            {/* Display Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[40px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Notch Cutout */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[148px] h-[28px] bg-black rounded-b-[18px] flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                {/* Speaker mesh slit */}
                <div className="w-12 h-1 bg-[#1a1c22] rounded-full border border-black" />
                {/* Camera dot */}
                <div className="w-2.5 h-2.5 rounded-full bg-[#080d19] ring-1 ring-[#1a2336] absolute right-4 top-2" />
              </div>

              {/* Status Bar flanking the notch */}
              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-8 px-6 z-20 pointer-events-none flex items-center justify-between text-white text-[12px] font-semibold tracking-tight">
                  <span className="font-mono text-[11px] pt-1">9:41</span>
                  <div className="flex items-center gap-1.5 pt-1">
                    <Wifi className="w-3 h-3 stroke-[2.5]" />
                    <div className="w-5 h-2.5 rounded-[3px] border border-white/70 p-0.5 flex items-center">
                      <div className="w-3/4 h-full bg-white rounded-[1px]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Screen Children Content */}
              <div className="w-full h-full relative overflow-hidden">{children}</div>

              {/* iOS Home Indicator Bar */}
              <div className="absolute bottom-[8px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[134px] h-[4px] bg-white/70 rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 3. iPHONE: CLASSIC WITH HOME BUTTON (iPhone 8, SE 2/3, 7 Plus)  */}
        {/* ================================================================ */}
        {frameType === "iphone-classic" && (
          <div
            className={`relative w-full h-full rounded-[44px] px-[14px] pt-[60px] pb-[68px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_40px_rgba(0,0,0,0.6)] flex flex-col items-center justify-between`}
          >
            {/* Left Mute & Volume buttons */}
            <div className={`absolute -left-[3px] top-[96px] w-[3px] h-[20px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[136px] w-[3px] h-[42px] rounded-l-sm ${finishStyle.button}`} />
            <div className={`absolute -left-[3px] top-[192px] w-[3px] h-[42px] rounded-l-sm ${finishStyle.button}`} />
            {/* Right Power button */}
            <div className={`absolute -right-[3px] top-[140px] w-[3px] h-[52px] rounded-r-sm ${finishStyle.button}`} />

            {/* TOP FOREHEAD BEZEL: Camera & Speaker Slit */}
            <div className="absolute top-0 inset-x-0 h-[60px] flex items-center justify-center pointer-events-none">
              {/* FaceTime Camera */}
              <div className="absolute top-[16px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#080d19] ring-1 ring-[#212738] shadow-inner" />
              {/* Earpiece Speaker Slit */}
              <div className="w-[52px] h-[3.5px] bg-[#1a1c22] border border-[#313645] rounded-full shadow-inner mt-2" />
            </div>

            {/* Display Inner Screen (Classic Sharp/Subtle Rounded Corners) */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[6px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0 border border-black/40"
            >
              {/* Classic iOS Status Bar */}
              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-5 px-3 z-20 pointer-events-none flex items-center justify-between text-[#d1d5db] text-[10px] font-medium bg-black/40 backdrop-blur-xs">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[9px]">9:41 AM</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-2.5 h-2.5" />
                    <span className="text-[9px]">100%</span>
                    <div className="w-4 h-2 rounded-[2px] border border-white/60 p-0.5 flex items-center">
                      <div className="w-full h-full bg-white rounded-xs" />
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full h-full relative overflow-hidden">{children}</div>
            </div>

            {/* BOTTOM CHIN BEZEL: Authentic Circular Touch ID Home Button */}
            <div className="absolute bottom-0 inset-x-0 h-[68px] flex items-center justify-center">
              <button
                type="button"
                className="w-[50px] h-[50px] rounded-full border-2 border-[#454c5c] hover:border-[#6366f1] active:scale-95 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.8),0_1px_2px_rgba(255,255,255,0.1)] bg-gradient-to-b from-[#161820] to-[#0c0d12] flex items-center justify-center cursor-pointer group"
                title="Touch ID Home Button"
                aria-label="Touch ID Home Button"
              >
                {/* Capacitive Touch ID inner circle */}
                <div className="w-[44px] h-[44px] rounded-full bg-[#111319] group-hover:bg-[#161822] transition shadow-inner" />
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 4. SAMSUNG: GALAXY S24 ULTRA (Sharp Boxy Titanium Frame)        */}
        {/* ================================================================ */}
        {frameType === "samsung-ultra" && (
          <div
            className={`relative w-full h-full rounded-[22px] p-[8px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col`}
          >
            {/* Right Buttons */}
            <div className={`absolute -right-[3px] top-[140px] w-[3px] h-[60px] rounded-r-sm ${finishStyle.button}`} />
            <div className={`absolute -right-[3px] top-[220px] w-[3px] h-[42px] rounded-r-sm ${finishStyle.button}`} />

            {/* Display Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[16px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Centered Punch-Hole Camera */}
              <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-3.5 h-3.5 rounded-full bg-black ring-1 ring-[#1b2234] flex items-center justify-center shadow-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0a1226]" />
              </div>

              {/* Android Status Bar */}
              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-7 px-4 z-20 pointer-events-none flex items-center justify-between text-white text-[11px] font-medium">
                  <span className="font-mono text-[10px]">10:00</span>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-3 h-3" />
                    <div className="w-4 h-2.5 rounded-[2px] border border-white/70 p-0.5 flex items-center">
                      <div className="w-full h-full bg-emerald-400 rounded-xs" />
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full h-full relative overflow-hidden">{children}</div>

              {/* Android Gesture Bar */}
              <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[90px] h-[3px] bg-white/60 rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 5. SAMSUNG: MODERN GALAXY S24/S23 (Rounded Aluminum)           */}
        {/* ================================================================ */}
        {frameType === "samsung-modern" && (
          <div
            className={`relative w-full h-full rounded-[42px] p-[10px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col`}
          >
            {/* Right Buttons */}
            <div className={`absolute -right-[3px] top-[140px] w-[3px] h-[50px] rounded-r-sm ${finishStyle.button}`} />
            <div className={`absolute -right-[3px] top-[204px] w-[3px] h-[40px] rounded-r-sm ${finishStyle.button}`} />

            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[32px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Punch hole */}
              <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-3.5 h-3.5 rounded-full bg-black ring-1 ring-[#1b2234] flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0a1226]" />
              </div>

              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-7 px-4 z-20 pointer-events-none flex items-center justify-between text-white text-[11px] font-medium">
                  <span className="font-mono text-[10px]">10:00</span>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-3 h-3" />
                    <div className="w-4 h-2.5 rounded-[2px] border border-white/70 p-0.5 flex items-center">
                      <div className="w-full h-full bg-emerald-400 rounded-xs" />
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full h-full relative overflow-hidden">{children}</div>
              <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[90px] h-[3px] bg-white/60 rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 6. GOOGLE PIXEL: MODERN PIXEL 9 / 8                             */}
        {/* ================================================================ */}
        {frameType === "pixel-modern" && (
          <div
            className={`relative w-full h-full rounded-[48px] p-[10px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col`}
          >
            {/* Right Buttons */}
            <div className={`absolute -right-[3px] top-[130px] w-[3px] h-[36px] rounded-r-sm ${finishStyle.button}`} />
            <div className={`absolute -right-[3px] top-[180px] w-[3px] h-[64px] rounded-r-sm ${finishStyle.button}`} />

            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[38px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Speaker slit at very top border */}
              <div className="absolute top-[2px] left-1/2 -translate-x-1/2 w-16 h-1 bg-[#252834] rounded-full z-30 pointer-events-none" />

              {/* Centered camera hole */}
              <div className="absolute top-[10px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-3.5 h-3.5 rounded-full bg-black ring-1 ring-[#1b2234] flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0d1629]" />
              </div>

              {showStatusBar && (
                <div className="absolute top-0 inset-x-0 h-8 px-6 z-20 pointer-events-none flex items-center justify-between text-white text-[11px] font-medium">
                  <span className="font-mono text-[10px]">9:30</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono">5G</span>
                    <div className="w-3.5 h-2 rounded-[2px] border border-white/70 p-0.5 flex items-center">
                      <div className="w-full h-full bg-emerald-400 rounded-xs" />
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full h-full relative overflow-hidden">{children}</div>
              <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[110px] h-[3.5px] bg-white/70 rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 7. CLASSIC ANDROID (Galaxy S8 / Pixel 2 Front Stereo Speakers)   */}
        {/* ================================================================ */}
        {(frameType === "samsung-classic" || frameType === "pixel-classic") && (
          <div
            className={`relative w-full h-full rounded-[38px] px-[12px] pt-[44px] pb-[44px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col items-center justify-between`}
          >
            {/* Top Forehead: Speaker & Camera */}
            <div className="absolute top-0 inset-x-0 h-[44px] flex items-center justify-center pointer-events-none">
              <div className="w-[56px] h-[3px] bg-[#1e222d] border border-[#2d3344] rounded-full shadow-inner" />
              <div className="absolute left-[36px] w-2 h-2 rounded-full bg-[#0d1017] ring-1 ring-[#262c3c]" />
            </div>

            {/* Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[16px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0 border border-black/50"
            >
              <div className="w-full h-full relative overflow-hidden">{children}</div>
            </div>

            {/* Bottom Chin: Speaker or soft navigation */}
            <div className="absolute bottom-0 inset-x-0 h-[44px] flex items-center justify-center pointer-events-none">
              {frameType === "pixel-classic" ? (
                <div className="w-[56px] h-[3px] bg-[#1e222d] border border-[#2d3344] rounded-full shadow-inner" />
              ) : (
                <div className="flex items-center gap-12 text-[#64748b] text-xs">
                  <span>◀</span>
                  <span>●</span>
                  <span>■</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 8. TABLET: iPAD PRO (Uniform Thin Bezel)                        */}
        {/* ================================================================ */}
        {frameType === "ipad-pro" && (
          <div
            className={`relative w-full h-full rounded-[36px] p-[16px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_30px_70px_-20px_rgba(0,0,0,0.95)] flex flex-col`}
          >
            {/* Display Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[20px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
            >
              {/* Subtle top bezel camera */}
              <div className="absolute top-[6px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-2 h-2 rounded-full bg-black ring-1 ring-[#242b3b]" />

              <div className="w-full h-full relative overflow-hidden">{children}</div>
              <div className="absolute bottom-[8px] left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[180px] h-[4.5px] bg-white/60 rounded-full shadow-sm" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 9. TABLET: iPAD CLASSIC (With Touch ID Home Button)              */}
        {/* ================================================================ */}
        {frameType === "ipad-classic" && (
          <div
            className={`relative w-full h-full rounded-[36px] px-[32px] pt-[52px] pb-[60px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_30px_70px_-20px_rgba(0,0,0,0.95)] flex flex-col items-center justify-between`}
          >
            {/* Top Forehead Camera */}
            <div className="absolute top-[22px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#080d19] ring-1 ring-[#242b3d]" />

            {/* Inner Screen */}
            <div
              ref={screenRef}
              style={{ width: `${width}px`, height: `${height}px` }}
              className="relative rounded-[8px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0 border border-black/50"
            >
              <div className="w-full h-full relative overflow-hidden">{children}</div>
            </div>

            {/* Bottom Touch ID Button */}
            <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2">
              <button
                type="button"
                className="w-[42px] h-[42px] rounded-full border-2 border-[#454c5c] bg-gradient-to-b from-[#181a20] to-[#0c0d12] shadow-inner flex items-center justify-center cursor-pointer hover:border-[#6366f1] transition"
                title="iPad Home Button"
                aria-label="iPad Home Button"
              >
                <div className="w-[36px] h-[36px] rounded-full bg-[#111319]" />
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 10. LAPTOP: MACBOOK PRO (Camera Notch & Aluminum Base Lip)       */}
        {/* ================================================================ */}
        {frameType === "macbook-pro" && (
          <div className="relative w-full h-full flex flex-col items-center">
            {/* Top Display Lid */}
            <div
              className={`relative rounded-t-[16px] px-[16px] pt-[16px] pb-[4px] ${finishStyle.chassis} border-b-0 ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)]`}
            >
              {/* Display Screen */}
              <div
                ref={screenRef}
                style={{ width: `${width}px`, height: `${height}px` }}
                className="relative rounded-t-[8px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0"
              >
                {/* MacBook Camera Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[110px] h-[20px] bg-black rounded-b-[8px] flex items-center justify-center gap-1.5 shadow-sm">
                  {/* Camera lens */}
                  <div className="w-2 h-2 rounded-full bg-[#0a1020] ring-1 ring-[#20283d]" />
                  {/* Green LED indicator */}
                  <div className="w-1 h-1 rounded-full bg-emerald-500/80" />
                </div>

                <div className="w-full h-full relative overflow-hidden">{children}</div>
              </div>
            </div>

            {/* Bottom MacBook Aluminum Base & Hinge */}
            <div
              style={{ width: `${metrics.totalWidth + 40}px` }}
              className="h-[20px] bg-gradient-to-b from-[#2a2e3a] via-[#1d2028] to-[#14161c] rounded-b-[10px] border border-[#3b4152] shadow-xl flex items-center justify-center relative shrink-0 -mt-[1px]"
            >
              {/* Trackpad Thumb Opening Notch */}
              <div className="w-[70px] h-[3.5px] bg-[#0c0d12] rounded-b-[4px] border-b border-[#3b4152]/60" />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 11. DESKTOP: STUDIO DISPLAY / MONITOR (Screen + Stand Base)      */}
        {/* ================================================================ */}
        {frameType === "desktop-monitor" && (
          <div className="relative w-full h-full flex flex-col items-center">
            {/* Monitor Bezel Frame */}
            <div
              className={`relative rounded-[16px] p-[12px] pb-[16px] ${finishStyle.chassis} ${finishStyle.rim} shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col items-center`}
            >
              {/* Top Camera Dot */}
              <div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-black ring-1 ring-[#293042]" />

              {/* Inner Screen */}
              <div
                ref={screenRef}
                style={{ width: `${width}px`, height: `${height}px` }}
                className="relative rounded-[6px] overflow-hidden bg-[#0a0c10] shadow-inner flex flex-col shrink-0 border border-black/60"
              >
                <div className="w-full h-full relative overflow-hidden">{children}</div>
              </div>

              {/* Bottom Monitor Chin Logo / Power LED */}
              <div className="w-full h-[12px] flex items-center justify-center mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/50 shadow-[0_0_4px_rgba(99,102,241,0.6)]" />
              </div>
            </div>

            {/* Aluminum Stand Neck */}
            <div className="w-[64px] h-[48px] bg-gradient-to-b from-[#252936] to-[#181a24] border-x border-[#383f52] shadow-inner relative z-0" />

            {/* Weighted Sturdy Desktop Base Foot */}
            <div className="w-[240px] h-[14px] bg-gradient-to-r from-[#1c1f28] via-[#2f3546] to-[#1c1f28] rounded-[6px] border border-[#3e465c] shadow-[0_15px_25px_rgba(0,0,0,0.8)] -mt-[2px] relative z-10" />
          </div>
        )}
      </div>
    </div>
  )
}
