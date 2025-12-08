# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EtherPad Soundscape is an interactive audio-visual web application/instrument. Users touch/click and drag on a canvas to generate synthesized tones with visual feedback. Multiple synthesis modes and scale quantization provide a rich musical experience.

## Development

```bash
npm install          # Install dependencies
npm run dev          # Development server with hot reload
npm run build        # Build for production
npm run deploy       # Build and deploy to Netlify
npm run typecheck    # Type check without emit
```

Live site: https://etherpad-soundscape.netlify.app

## File Structure

```
/
├── index.html          # Main HTML shell
├── css/
│   └── styles.css      # All CSS styles
├── src/
│   ├── main.ts         # Entry point, app initialization
│   ├── AudioEngine.ts  # Web Audio synthesizer (7 modes)
│   ├── visualizer.ts   # Canvas/mel spectrogram rendering
│   ├── controls.ts     # Touch/mouse/orientation handlers
│   └── LoopRecorder.ts # Loop recording and playback
├── vite.config.ts      # Vite build configuration
├── tsconfig.json       # TypeScript configuration
├── package.json        # Dependencies and scripts
├── CLAUDE.md           # This file
└── .gitignore
```

## Architecture

### AudioEngine (src/AudioEngine.ts)
Multi-mode Web Audio synthesizer with:
- **7 synthesis modes**: Wavetable, Theremin, FM, Chords, Karplus-Strong, Granular, Ambient
- **Multitouch polyphony**: Each finger creates an independent voice
- **Scale quantization**: Major, Minor, Pentatonic, Chromatic scales with selectable tonic
- **Touch duration**: Affects envelope and sound evolution
- **Device orientation**: Beta controls filter cutoff, Gamma controls Q
- **Shake detection**: Triggers delay feedback burst

### Visualizer (src/visualizer.ts)
- Real-time mel spectrogram (256 bins)
- Colorful intensity gradient (black→blue→magenta→red→orange→yellow→white)
- Grid overlay and cursor glow effects
- Ripple animations on interaction
- Mode-specific visual overlays (waveform zones in wavetable mode)

### Controls (src/controls.ts)
- Multi-touch support with touch duration tracking
- Mouse fallback for desktop
- iOS DeviceOrientation/DeviceMotion permission handling
- Mode selector and scale control initialization
- Loop recorder integration

### LoopRecorder (src/LoopRecorder.ts)
- Records touch events with timestamps
- Plays back loops continuously
- Supports layering live playing over loop playback

## Key Technical Details

- **TypeScript** with Vite for fast builds
- **ES modules** bundled for production
- Tailwind CSS via CDN for overlay styling
- Mobile-optimized with `touch-action: none`
- iOS audio unlock via silent audio element
- Lowpass filter: 80Hz-8000Hz (beta tilt), Q: 0.5-15 (gamma tilt)
