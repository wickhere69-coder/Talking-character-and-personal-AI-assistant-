# 🎙️ 3D Talking Character App

A browser-based 3D application featuring a photorealistic, fully-rigged avatar with frame-accurate lip sync, procedural facial animations, three-point studio lighting, post-processing color grading, and broadcast controls.

Runs **100% locally** with **zero mandatory paid services** or API keys.

---

## ✨ Features

- **3D Ready Player Me Avatar**: Full ARKit 52 blend shapes + Oculus 15 visemes support.
- **Two-Layer Lip-Sync Engine**:
  - **Layer 1 (Timestamped Visemes)**: Millisecond-accurate phoneme-to-viseme mapping with cosine easing (`0.5 - 0.5 * cos(π * t)`) and co-articulation.
  - **Layer 2 (FFT Fallback)**: Real-time frequency-band energy analysis via Web Audio API `AnalyserNode` for uploaded audio files (`.mp3`, `.wav`, `.ogg`).
- **Secondary Motion / Life System**:
  - Procedural blinking on randomized 2–6s intervals, plus speech-pause blinks.
  - Natural breathing cycles on spine bones with subtle vertical sway.
  - Multi-frequency head sway on separate axes.
  - Eyebrow micro-raises on stressed syllables.
  - Eye gaze tracking with randomized saccades (~100ms micro-darts).
  - Smooth settle-to-idle blend when speech stops.
- **Broadcast Studio Environment**:
  - Three-point lighting (Key, Fill, Rim/Hair light).
  - HDRI studio reflections with `@react-three/drei` `Environment`.
  - Reflective floor and soft `ContactShadows`.
  - ACES Filmic tone mapping, Bloom, and Vignette post-processing (configured without double tone mapping).
  - Dual camera presets (Wide & Close-up) with smooth damping and subtle handheld breathing motion.
- **TTS Backends (All Free-Tier Compatible)**:
  1. **Web Speech API** (*Default*): Built into your browser, 100% free, no account or API keys required.
  2. **Azure Cognitive Services Speech SDK**: Free tier (F0) provides 500,000 characters/month with millisecond viseme timestamps.
  3. **ElevenLabs**: Free tier provides 10,000 characters/month with word-level alignment timestamps.
- **Local Backend Proxy**:
  - Express server on `http://localhost:3001` keeps your Azure / ElevenLabs keys secure on your machine without exposing them in browser network tabs.

---

## 🚀 Quick Start

### 1. Start the App

From the project directory (`C:\Users\hp\.gemini\antigravity\scratch\talking-character-app`):

```bash
npm.cmd run dev
```

This starts both:
- **Client**: `http://localhost:5173` (Vite)
- **Proxy Server**: `http://localhost:3001` (Express)

Open **[http://localhost:5173](http://localhost:5173)** in your browser (Chrome, Edge, Brave, or Firefox).

---

## 🔑 Optional: Configuring Azure / ElevenLabs (Free Tiers)

By default, the app runs with the browser's built-in **Web Speech API** without any configuration.

If you want to use Azure or ElevenLabs free tiers:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your keys:
   ```env
   # Azure Speech (Free Tier F0: 500k chars/mo)
   AZURE_SPEECH_KEY=your_azure_key_here
   AZURE_SPEECH_REGION=eastus

   # ElevenLabs (Free Tier: 10k chars/mo)
   ELEVENLABS_API_KEY=your_elevenlabs_key_here

   PORT=3001
   ```
3. Restart `npm.cmd run dev`. The buttons in the UI for **Azure** and **ElevenLabs** will automatically activate!

---

## 📁 Project Structure

```
talking-character-app/
├── server/
│   └── index.ts                 # Express proxy for Azure & ElevenLabs APIs
├── src/
│   ├── components/
│   │   ├── 3d/
│   │   │   ├── Character.tsx    # Avatar loader & per-frame animation driver
│   │   │   ├── StudioScene.tsx  # Studio lighting, floor, cyclorama, HDRI
│   │   │   ├── CameraRig.tsx    # Wide / Close-up camera presets & handheld breathing
│   │   │   └── PostProcessing.tsx # Bloom, Vignette, ACES Filmic tone mapping
│   │   └── ui/
│   │       ├── ControlPanel.tsx # Glass-morphism control sidebar
│   │       └── LowerThird.tsx   # Broadcast subtitle overlay
│   ├── engine/
│   │   ├── LipSyncController.ts # Two-layer lip-sync (Visemes + Web Audio FFT)
│   │   ├── ProceduralAnimation.ts # Blinking, breathing, gaze, saccades
│   │   ├── phonemizer.ts        # Pronunciation dictionary & fallback rules
│   │   └── visemeMappings.ts    # ARKit 52 & Oculus 15 viseme lookup tables
│   ├── services/
│   │   ├── webSpeechService.ts  # Browser window.speechSynthesis wrapper
│   │   ├── azureSpeechService.ts # Azure Speech SDK synthesis & visemes
│   │   ├── elevenLabsService.ts # ElevenLabs timestamp alignment synthesis
│   │   └── ttsService.ts        # Unified TTS dispatcher
│   ├── store/
│   │   └── appStore.ts          # Central Zustand state store
│   ├── types/
│   │   └── index.ts             # Shared TypeScript types
│   ├── App.tsx                  # Root canvas & UI composition
│   ├── main.tsx                 # React entry point
│   └── index.css                # Tailwind CSS v4 styling
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ Build Commands

- **Development**: `npm.cmd run dev`
- **Type Check**: `npm.cmd run typecheck`
- **Production Build**: `npm.cmd run build`
- **Client Only**: `npm.cmd run dev:client`
- **Server Only**: `npm.cmd run dev:server`
