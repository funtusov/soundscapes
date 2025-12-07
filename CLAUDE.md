# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EtherPad Soundscape is a single-file interactive audio-visual web application. Users touch/click and drag on a canvas to generate synthesized tones with visual feedback.

## Development

This is a standalone HTML file with no build process. To run:
- Open `index.html` directly in a browser, or
- Serve with any static file server (e.g., `python -m http.server`)

## Architecture

The entire application lives in `index.html` with three main components:

1. **AudioEngine class** - Web Audio API synthesizer with:
   - 4 oscillators with harmonic ratios (1x, 2x, 3x, 5x fundamental)
   - Lowpass filter and stereo delay effects
   - FFT analyser for visualization
   - iOS audio unlock workaround using silent audio element

2. **Visual Engine** - Canvas-based rendering:
   - Real-time FFT spectrum visualization
   - Grid overlay and cursor glow effects
   - Ripple animations on interaction

3. **Interaction Layer** - Input handling:
   - X-axis controls pitch (65Hz-880Hz exponential)
   - Y-axis controls harmonic content and filter cutoff
   - Supports both mouse and touch input

## Key Technical Details

- Uses Tailwind CSS via CDN for overlay styling
- Mobile-optimized with `touch-action: none` and passive event listeners
- Bypasses iOS mute switch using silent audio element trick
