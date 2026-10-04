# Badminton Tactics Board · 羽毛球战术棋盘

**▶ Play online / 在线试玩: https://badminton-tactics-board.vercel.app**

A canvas-based badminton tactics game: read the incoming shuttle, plan your footwork, choose a shot, and manage stamina and balance. Runs fully offline in the browser (installable as a PWA). Available in **English** and **中文**.

一个基于 Canvas 的羽毛球战术棋盘游戏：预判来球、规划步伐、选择击球，并管理体力与稳定度。纯前端、可离线运行（可安装为 PWA），支持 **English** 与 **中文**。

## Run locally / 本地运行

```bash
python3 -m http.server 8765    # or any static server
# open http://localhost:8765/
```

Best played in landscape on a phone, or in a desktop browser window. / 手机请横屏游玩，桌面浏览器直接打开即可。

## Language / 语言

- English is the default. A persistent **EN / 中文** switch sits in the top bar of every screen (press **L** on a keyboard as a shortcut). The choice is remembered; `?lang=en` / `?lang=zh` forces one.
- Switching reloads the page, so a match in progress restarts.
- 默认英文。每个界面顶部都有 **EN / 中文** 切换按钮（键盘按 **L** 也可切换），选择会被记住，也可用 `?lang=en` / `?lang=zh` 指定。切换语言会重新加载页面，进行中的对局会重新开始。

### Adding or fixing translations

Source strings in the code are Chinese and double as lookup keys: `$t('选择步伐')`. English lives in `src/i18n-en.js` (`{ "中文原文": "English" }`). A missing key falls back to the Chinese text. To add another language, add a new dictionary file, load it in `index.html` before `src/i18n.js`, and extend the lookup in `src/i18n.js`.

## Structure

| File | Role |
| --- | --- |
| `index.html`, `android-entry.js` | Page shell and canvas/input wiring |
| `src/i18n.js`, `src/i18n-en.js` | i18n runtime and English dictionary |
| `src/court-rules.js`, `shot-model.js`, `footwork-model.js`, `recovery-model.js`, `feedback-model.js`, `engine.js` | Game rules and simulation (UI-independent) |
| `src/view.js` | Canvas renderer and interaction |
| `sw.js`, `manifest.webmanifest` | Offline cache / PWA |

## Origin

The game logic was recovered from the Android package `羽毛球战术棋盘-0.27.apk` (v0.27.0), which wraps this same web app in a WebView.

## Deploy

Production: https://badminton-tactics-board.vercel.app (auto-deployed from `main` via the Vercel Git integration).

Static site, no build step. `vercel --prod` from this directory, or import the repo in Vercel (Framework: Other, no build command, output directory `.`).
