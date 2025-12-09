# Oneheart-Style Ambient Music Generator - Implementation Plan

## Overview

Transform the existing EtherPad Soundscape into an Oneheart-style ambient music generator. The goal is to create an app where users can generate and control continuous, dreamy ambient music with minimal interaction.

## Current State Analysis

**Existing foundations we can build upon:**
- `AudioEngine.ts`: Already has ambient mode with drones, noise bed, shimmer - needs enhancement
- Convolution reverb system (but short tails, needs longer)
- LFO modulation framework
- Touch-based XY control
- Scale/chord systems
- Device orientation control

**Key gaps to fill:**
- Sound design doesn't match Oneheart aesthetic (too clean, needs warmth)
- Reverb too short (current: 2.5s, need: 5-10s)
- No vinyl/tape texture layer
- Chord progressions too static
- UI designed for "instrument", not "ambient environment"

---

## Phase 1: Core Sound Engine Enhancements

### 1.1 Create New "Oneheart" Synthesis Mode

**File: `src/AudioEngine.ts`**

Add new mode alongside existing modes. Key differences from current ambient:
- Warmer oscillator tones (detuned saws → sine/triangle blend)
- Much slower attack/release (2-8 seconds)
- Richer detuning (±5-15 cents across 4-6 oscillators per voice)
- Lower frequency range focus (fundamental 40-200Hz)

```
New interfaces:
- OneheartPadVoice: Multiple detuned oscillators per voice
- OneheartChordState: Current chord, next chord, transition progress
- OneheartTextureState: Vinyl noise, tape hiss levels
```

### 1.2 Enhanced Pad/Drone System

Create new pad synthesis:
- **4-6 oscillators per pad voice** with slight detune (±3-15 cents)
- **Oscillator types**: Mix of sine (warmth) + filtered saw (presence)
- **Slow filter sweep**: 200Hz-2000Hz over 10-30 seconds
- **Stereo spread**: Individual panning per oscillator layer

### 1.3 Chord Progression Generator

**File: `src/constants.ts` (new constants)**

```typescript
ONEHEART_PROGRESSIONS = [
  // Dreamy progressions (all in relative semitones)
  [[0,4,7,11], [5,9,12,16], [7,11,14,17], [0,4,7,11]],  // I - IV - V - I (maj7)
  [[0,3,7,10], [5,8,12,15], [3,7,10,14]],               // i - iv - III (min7)
  // ... more progressions
]

ONEHEART_CHORD_DURATION = 8000-16000ms  // Time per chord
ONEHEART_TRANSITION_TIME = 4000ms       // Crossfade between chords
```

### 1.4 Long Reverb Implementation

**File: `src/constants.ts` + `src/AudioEngine.ts`**

New reverb presets for Oneheart mode:
```typescript
ONEHEART_REVERB = {
  decay: 8.0,      // 8 second tail
  wet: 0.7,
  dry: 0.5,
  earlyReflections: 0.3,
  damping: 0.4     // High frequency rolloff
}
```

Enhance `generateImpulseResponse()`:
- Longer IR buffer (8-10 seconds)
- More filtered noise (smoother tail)
- Gentle high-frequency damping over time

---

## Phase 2: Texture Layer System

### 2.1 Vinyl/Crackle Generator

**New module: `src/textures.ts`**

```typescript
class TextureGenerator {
  private ctx: AudioContext;
  private vinylSource: AudioBufferSourceNode;
  private vinylGain: GainNode;

  createVinylCrackle(): void {
    // Generate procedural vinyl noise:
    // - Base: filtered white noise (lowpass 2-4kHz)
    // - Crackle: random impulses at ~5-20 per second
    // - Hiss: very quiet high-frequency noise
  }

  setIntensity(level: number): void {
    // 0 = silent, 1 = prominent vinyl character
  }
}
```

### 2.2 Tape Saturation/Warmth

Add subtle saturation to master chain:
```typescript
createWarmthProcessor(): WaveShaperNode {
  // Soft-knee saturation curve
  // Adds even harmonics for analog warmth
}
```

---

## Phase 3: Generative Evolution System

### 3.1 Multi-Timescale Evolution

**File: `src/evolution.ts` (new)**

```typescript
interface EvolutionState {
  // Micro (1-5 sec): Subtle parameter drift
  microPhase: number;

  // Meso (30-60 sec): Chord changes, texture density
  mesoPhase: number;

  // Macro (3-10 min): Overall mood arc (bright ↔ dark)
  macroPhase: number;
}

class AmbientEvolution {
  evolve(dt: number): EvolutionParams {
    // Returns current evolution state for all parameters
    // Each timescale influences different aspects
  }
}
```

### 3.2 Parameter Random Walk

Smooth, continuous evolution:
- Filter cutoff: Slow random walk 200-4000Hz
- Stereo width: Gradually shift between narrow/wide
- Texture density: Fade vinyl/hiss in and out
- Chord root: Occasional shifts (every 2-4 chords)

---

## Phase 4: User Interface Redesign

### 4.1 Mood Mode System

Instead of continuous controls, implement discrete mood presets:

**Mood Modes (v1 - starting with Focus):**

| Mode | BPM Feel | Key Center | Texture | Brightness | Use Case |
|------|----------|------------|---------|------------|----------|
| **Focus** | ~60-80 | Major 7ths | Minimal vinyl | Medium-bright | Work, study |
| Relaxation | ~50-60 | Sus chords | Light vinyl | Warm | Unwinding |
| Sleep | ~40-50 | Minor, sparse | Heavier vinyl | Dark, muted | Falling asleep |

**Focus Mode Sound Profile:**
```typescript
FOCUS_PRESET = {
  tempoFeel: 70,           // Gentle pulse, not too slow
  chordTypes: ['maj7', 'add9', 'sus2'],
  rootMovement: 'fourths', // I → IV → I movement
  filterRange: [400, 3000], // Brighter, more presence
  textureLevel: 0.1,       // Minimal vinyl/hiss
  reverbDecay: 5.0,        // Medium-long tail
  evolutionSpeed: 'medium' // Changes every ~20-30 seconds
}
```

### 4.2 Simplified Control Surface

**File: `index.html` + `css/styles.css`**

Minimal UI - the music is the focus:

```
┌─────────────────────────────────────┐
│                                     │
│          [Visualization]            │
│     (Gentle, flowing particles)     │
│                                     │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  [Focus]  [Relax]  [Sleep]         │  ← Mode tabs (v1: only Focus)
│                                     │
│  [Play/Pause]           [Settings] │  ← Minimal controls
└─────────────────────────────────────┘
```

### 4.3 Touch Gesture Mapping

Simplified for ambient experience:
- **Tap canvas**: Trigger gentle chord change
- **Swipe/drag**: Nudge evolution direction (subtle influence)
- **Device tilt**: Filter cutoff (existing behavior, works well)
- **Shake**: Trigger momentary brightness/energy boost

### 4.4 Visual Feedback

**File: `src/visualizer.ts`**

New visualization mode for Oneheart/Focus:
- Simplify or remove spectrogram (too "analytical" for ambient)
- Add: Gentle color gradient shifts matching chord changes
- Add: Subtle breathing animation synchronized to evolution
- Keep minimal - visuals should not distract from focus work

---

## Phase 5: File Structure Reorganization

### Proposed New Structure

```
src/
├── main.ts                 # Entry point (minimal changes)
├── AudioEngine.ts          # Core engine (add oneheart mode)
├── constants.ts            # Add oneheart constants
├── controls.ts             # Simplified controls for oneheart
├── visualizer.ts           # Add oneheart visualization
├── LoopRecorder.ts         # Keep for other modes
│
├── oneheart/               # NEW: Oneheart-specific modules
│   ├── pad.ts              # Pad/drone synthesis
│   ├── chords.ts           # Chord progression generator
│   ├── textures.ts         # Vinyl, tape hiss generators
│   ├── evolution.ts        # Generative evolution system
│   └── visualizer.ts       # Oneheart-specific visuals
│
└── types.ts                # Shared type definitions
```

---

## Implementation Order

### MVP: Focus Mode (v1)

#### Step 1: Sound Foundation
1. Add new "oneheart" synthesis mode to AudioEngine
2. Create Focus mode pad voice (4-6 detuned sine/triangle oscillators)
3. Add longer reverb preset (5-8 second decay)
4. Implement Focus chord progression (maj7, sus2, add9 chords)

#### Step 2: Evolution System
5. Build basic evolution loop (chord cycling every 20-30s)
6. Add slow filter sweep automation
7. Implement subtle parameter drift (detune, stereo width)

#### Step 3: Minimal Textures
8. Add optional light vinyl texture (subtle, off by default for Focus)
9. Tape warmth/saturation on master bus

#### Step 4: UI for Focus Mode
10. Create minimal UI (Play/Pause, mode selector stub)
11. Simplify or hide instrument controls when in Oneheart mode
12. Add basic visualization (repurpose ambient zones or simple particles)

#### Step 5: Polish & Test
13. Tune sound design to match Oneheart/focus aesthetic
14. Test on mobile (iOS Safari, Chrome Android)
15. Performance optimization

### Future: Relaxation & Sleep Modes (v2+)
- Add Relaxation preset (slower, warmer, sus chords)
- Add Sleep preset (darker, sparser, more vinyl)
- Mode transition animations
- Timer/scheduler feature ("play for 30 minutes")

---

## Technical Considerations

### Performance
- Limit total oscillator count (current: 10-20 for ambient, keep similar)
- Use offline-generated noise buffers where possible
- Throttle evolution updates to 60fps (current ambient uses 16ms interval)

### Browser Compatibility
- All Web Audio features used are well-supported
- Convolver (for reverb) works in all modern browsers
- Test iOS Safari specifically (most users will be mobile)

### Audio Quality
- Sample rate: 48kHz (standard, good quality)
- Long reverb IRs: Pre-generate, cache in memory
- Vinyl texture: Pre-generate 2-4 second loop, crossfade

---

## Success Criteria

### v1 (Focus Mode) Complete When:
1. □ User can start continuous ambient "focus" music with one tap
2. □ Sound has Oneheart character: warm pads, long reverb, dreamy chords
3. □ Music evolves naturally (chord changes every 20-30s, filter sweeps)
4. □ Minimal UI: Play/Pause + mode selector (Focus active, others greyed)
5. □ Tapping canvas triggers gentle chord transition
6. □ Works smoothly on mobile devices (iOS Safari, Android Chrome)
7. □ Existing EtherPad modes still accessible and functional

### v2+ (Full Release):
- Relaxation and Sleep modes implemented
- Timer/duration controls
- Settings for texture levels
- Smooth transitions between modes
