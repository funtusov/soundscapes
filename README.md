# EtherPad Soundscape

An interactive audio-visual synthesizer instrument for touch devices. Create evolving soundscapes by touching, dragging, and tilting your phone or tablet.

**[Try it live →](https://etherpad-soundscape.netlify.app)**

## Features

- **7 Synthesis Modes** - Different sound engines to explore
- **Multitouch Polyphony** - Each finger creates an independent voice
- **Scale Quantization** - Notes snap to musical scales (Major, Minor, Pentatonic, Chromatic)
- **Tilt Controls** - Device orientation controls filter and resonance
- **Shake Effects** - Shake your device to trigger delay feedback bursts
- **Mel Spectrogram** - Real-time frequency visualization
- **Touch Duration** - Hold longer for evolving timbres and longer release

## Controls

### Touch
| Axis | Effect |
|------|--------|
| **X (horizontal)** | Pitch - notes quantized to selected scale |
| **Y (vertical)** | Mode-specific parameter (waveform, vibrato, mod index, etc.) |
| **Hold duration** | Sound evolves over time; longer hold = longer release |

### Device Tilt
| Tilt | Effect |
|------|--------|
| **β (forward/back)** | Filter cutoff (8000Hz flat → 80Hz tilted forward) |
| **γ (left/right)** | Filter resonance Q (0.5 flat → 15 tilted) |

### Shake
Shake your device to trigger a delay feedback burst effect.

## Synthesis Modes

| Mode | Description |
|------|-------------|
| **Wave** | Wavetable morphing - Y controls waveform (sine → triangle → saw → square) |
| **Scale** | Theremin-style - Y controls vibrato depth, notes quantized to scale |
| **FM** | FM synthesis - Y controls modulation index, sound evolves from mellow to metallic |
| **Chords** | Polyphonic - each finger plays a note, waveform warms up over time |
| **String** | Karplus-Strong physical modeling - tap to pluck, hold to bow |
| **Grain** | Granular drone - Y controls harmonic density, duration increases spread |
| **Ambient** | Self-sustaining drone - touch to nudge, sound continues evolving on its own |

## Scale Selection

Choose your musical scale using the dropdowns:
- **Tonic**: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- **Scale**: Major, Minor, Pentatonic, Chromatic

## Technical Details

### Architecture
```
js/
├── main.js         # App initialization
├── AudioEngine.js  # Web Audio synthesizer
├── visualizer.js   # Canvas & mel spectrogram
└── controls.js     # Touch/orientation handlers
```

### Audio Signal Chain
```
Oscillators → Lowpass Filter → Stereo Panner → Master Gain → Analyser → Output
                    ↓
              Stereo Delay (with feedback)
```

### Technologies
- **Web Audio API** - Synthesis, filtering, effects
- **ES6 Modules** - Clean code organization
- **Canvas API** - Real-time spectrogram visualization
- **DeviceOrientation API** - Tilt and motion controls
- **Tailwind CSS** - UI styling

## Development

No build process required.

```bash
# Clone the repo
git clone https://github.com/funtusov/soundscapes.git
cd soundscapes

# Serve locally (any static server works)
python -m http.server 8000
# or
npx serve

# Deploy to Netlify
netlify deploy --prod
```

## Browser Support

- **iOS Safari** - Full support including motion/orientation (requires HTTPS)
- **Chrome/Edge** - Full support
- **Firefox** - Full support
- **Desktop** - Mouse input supported as fallback

## Tips for Best Experience

1. **Use headphones** - Stereo delay effects are best appreciated with headphones
2. **HTTPS required** - Device orientation APIs require secure context
3. **Try Ambient mode** - Great for background soundscapes
4. **Experiment with tilt** - Filter sweeps add expression
5. **Use multiple fingers** - Build chords and textures

## License

MIT

---

*Created with Claude Code*
