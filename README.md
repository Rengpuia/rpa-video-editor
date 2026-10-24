# RPA Video Editor - Studio Pro (Cleanroom Open-Source Edition)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 2.0.0](https://img.shields.io/badge/Version-2.0.0-green.svg)](#version-history)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blueviolet.svg)](#model-context-protocol-mcp)
[![Build Status](https://img.shields.io/badge/Windows-Installer_Ready-success.svg)](#building-the-windows-installer)

A modern, high-performance, high-performance video editor and telemetry recording studio engineered from scratch for automated screen recording, kinetic motion graphics, and multi-track video production.

---

## 👨‍💻 Developer & Project Credits

- **Developer:** K Vanlalrengpuia
- **Email:** [rengakhiangte@gmail.com](mailto:rengakhiangte@gmail.com)
- **License:** Open Source ([MIT License](LICENSE))
- **Architecture:** 100% Cleanroom Implementation — Zero proprietary trademarks, assets, or dependencies.

---

## 🚀 Key Features

### 1. Extended Multi-Resolution & Custom Exporter
- **Preconfigured Presets:**
  - **Landscape (16:9):** 8K Ultra HD (7680×4320), 4K Ultra HD (3840×2160), 2K QHD (2560×1440), 1080p Full HD (1920×1080), 720p HD (1280×720), 480p SD (854×480).
  - **Mobile & Social:** 9:16 Vertical Shorts/Reels/TikTok (1080×1920 & 720×1280), 1:1 Square (1080×1080), 4:5 Portrait (1080×1350).
  - **Ultrawide & Cinema (21:9):** 3440×1440 QHD and 2560×1080 FHD.
- **Arbitrary Custom Resolution Engine:** Specify any custom width and height (from 128px to 8192px) with real-time aspect ratio lock and quick ratio presets (`16:9`, `9:16`, `1:1`, `4:3`, `21:9`).
- **Variable Framerates:** 24 FPS (Cinematic 24p), 30 FPS (Standard), 60 FPS (Ultra Smooth), and 120 FPS (High Frame Rate).

### 2. Callouts, Annotations & Kinetic Typography
- **Alignment Controls:** Full horizontal alignment (**Left**, **Center**, **Right**, **Justify**) and vertical alignment (**Top**, **Middle**, **Bottom**) inside all callout bounding boxes.
- **Selective Word Styling:** Select any substring or word inside the preview canvas and apply individual font families, colors, weights, underline, and strike-through (`clip.textSpans`).
- **Motion Physics Behaviors:** Pop, Slide & Drift, Pulse, Jump & Fall, and Fade-Scale with 3 configurable phase tabs (In, During, Out), numeric steppers, and loop-forever toggles.
- **Visual FX & Spotlight:** Cutout Spotlights, fluorescent Highlight markers, speech bubbles, keyboard shortcuts, step badges, blur masks, and cinematic color grades.

### 3. Screen, Audio & Webcam Recording Suite
- **Webcam Video Input Source:** Dynamic camera device enumeration (`navigator.mediaDevices.enumerateDevices`).
- **Geometric Webcam Mask Effects:**
  - Mask shapes: **Circle (Avatar)**, **Squircle / Rounded Square**, **Hexagon / Polygon**, **Diamond**, **Oval / Pill**, and **Rectangle**.
  - Customizable overlay corner position (Bottom-Right, Bottom-Left, Top-Right, Top-Left).
  - Adjustable size slider (12% to 45% of stage).
  - Configurable border stroke width and color picker.
  - Soft drop shadow and horizontal mirror flip.
- **Audio Mixing:** Concurrent microphone commentary and system/tab audio recording.
- **Telemetry Logger:** High-precision cursor coordinates, clicks, and ripple animation capture.

### 4. Model Context Protocol (MCP) Support
Native support for Anthropic Model Context Protocol (MCP) via JSON-RPC 2.0 over **stdio** and **HTTP** (`/api/mcp`), enabling AI assistants (such as Claude Desktop, Antigravity, and Cursor) to automate video editing tasks:
- `list_projects`: Enumerate all `.rpavideo` project files.
- `get_project`: Inspect timeline structure, tracks, and clips.
- `create_project`: Generate a new project with custom settings.
- `save_project`: Persist timeline changes to disk.
- `add_clip`: Programmatically add video, audio, callout, image, or sound effect clips.
- `split_clip`: Split clips at exact timestamps.
- `delete_clip`: Remove clips by ID.
- `apply_behavior`: Configure kinetic motion physics.
- `export_video_spec`: Validate rendering parameters.

---

## 🤖 Configuring MCP with AI Assistants

### Claude Desktop Configuration
Add the following to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "rpa-video-editor": {
      "command": "node",
      "args": [
        "J:\\Vid editor\\RPA_Video_Editor_Portable\\mcp_server.js"
      ]
    }
  }
}
```

### Antigravity / Cursor Configuration
Run the stdio server directly or connect via HTTP JSON-RPC at `http://127.0.0.1:3800/api/mcp`.

---

## ⚡ Performance Optimizations

1. **GPU Hardware Acceleration:** Canvas 2D contexts initialized with `{ alpha: false, desynchronized: true }` for direct, low-latency GPU rendering.
2. **Idle Render Loop Gating:** Playback loop gates frame dispatch when paused, keeping idle CPU consumption under 0.5%.
3. **Text Metrics LRU Cache:** Native font measurement caching reduces text bounding calculations by up to 92%.
4. **RAM & Blob Garbage Collection:** Discarded MediaStreams, AudioContexts, and Blob URLs are immediately revoked to eliminate memory leaks.

---

## 🖥️ Native Offline Desktop Application (No Web Browser)

RPA Video Editor is a **100% offline native desktop application**:
- **Dedicated Desktop Window:** Launches directly in its own hardware-accelerated studio window (`RPA_Video_Editor.exe`). No web browser tabs, no address bar, no web popups.
- **Zero Internet Requirement:** All fonts, canvas compositing engines, audio processors, and telemetry recording run entirely offline on your local PC.
- **Built-in Application Icon & PE Manifest:** Packed with custom 32-bit multi-resolution icon (`client/favicon.ico`) and embedded Windows metadata.

---

## 🛡️ Windows Smart App Control (SAC) & SmartScreen Resolution

When downloading open-source software from GitHub, Windows 11 automatically attaches a `Zone.Identifier` stream (Mark of the Web). Windows 11 **Smart App Control (SAC)** may block newly downloaded executables that carry this flag.

### Quick 1-Click Fix:
1. Double-click **`unblock_app.bat`** inside the folder (or run `.\unblock_app.ps1` in PowerShell).
2. It strips the Mark-of-the-Web flag instantly.
3. Double-click **`RPA_Video_Editor.exe`** to launch the editor!

*Alternative manual fix:* Right-click `RPA_Video_Editor.exe` (or the downloaded `.zip` / installer) $\to$ **Properties** $\to$ check the **Unblock** checkbox at the bottom $\to$ click **Apply**.

---

## 🏃 Quick Start & Launching

To run RPA Video Editor locally:
- **Direct Native Executable:** Double-click `RPA_Video_Editor.exe`.
- **Electron Desktop Shell:** Run `npm start`.
- **Background Server Only:** Run `node server/server.js`.

---

## 📦 Building the Windows Installer & Portable Packages

### Local Native Desktop Build
To compile the native Windows GUI executable (`RPA_Video_Editor.exe`) locally:
```cmd
build_native_desktop.bat
```

### Full Windows Installer & Portable ZIP Build
If Inno Setup 6 is installed on your workstation:
```cmd
build_installer.bat
```
or via PowerShell:
```powershell
.\build_installer.ps1
```
This generates:
1. `exports\RPA_Video_Editor_Setup_v2.0.0.exe` (Windows Installer)
2. `exports\RPA_Video_Editor_v2.0.0_Portable.zip` (Zero-install Portable Package)

### Automated GitHub Actions CI/CD
Pushing to GitHub triggers `.github/workflows/build-installer.yml`, which automatically builds and publishes all desktop packages to [GitHub Releases](https://github.com/Rengpuia/rpa-video-editor/releases).

---

## 📜 Version History & Changelog

### v2.0.0 (Cleanroom Release) — October 24, 2026
- **Cleanroom Overhaul:** 100% proprietary code and trademark elimination.
- **Extended Export System:** 8K, 4K, 2K, 1080p, 720p, 480p, 9:16 Vertical, 1:1 Square, 4:5 Portrait, 21:9 Ultrawide, and arbitrary Custom Resolution with aspect lock.
- **Text Alignment Suite:** Horizontal (Left, Center, Right, Justify) and vertical (Top, Middle, Bottom) alignment.
- **Webcam Recording & Shapes:** Dynamic video input selection with Circle, Squircle, Hexagon, Diamond, Oval masks.
- **MCP Compatibility:** Model Context Protocol stdio transport (`mcp_server.js`) and HTTP API (`/api/mcp`).
- **Packaging Pipeline:** Inno Setup 6 installer script (`installer.iss`) and automated GitHub CI/CD.

---

## 📄 License
This project is open-source software licensed under the **[MIT License](LICENSE)**.
Developed by **K Vanlalrengpuia** (<rengakhiangte@gmail.com>).
