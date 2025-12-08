/**
 * CONTROLS - Input handling (touch, mouse, device orientation)
 */

import { addRipple, setCursor, setTouching, getCanvasSize } from './visualizer.js';

const activeTouches = new Map();

export function initControls(audio) {
    // Mouse events
    window.addEventListener('mousedown', e => handleStart(e.clientX, e.clientY, 'mouse', audio));
    window.addEventListener('mousemove', e => {
        if (activeTouches.has('mouse')) handleMove(e.clientX, e.clientY, 'mouse', audio);
    });
    window.addEventListener('mouseup', () => handleEnd('mouse', audio));

    // Touch events
    window.addEventListener('touchstart', e => {
        if (e.target.closest('.mode-selector')) return;
        if (e.target.closest('.scale-controls')) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleStart(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleMove(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchend', e => {
        if (e.target.closest('.mode-selector')) return;
        if (e.target.closest('.scale-controls')) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleEnd(touch.identifier, audio);
        }
    });

    window.addEventListener('touchcancel', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleEnd(touch.identifier, audio);
        }
    });
}

function handleStart(x, y, touchId, audio) {
    const { width, height } = getCanvasSize();

    // Ignore touches in the control area
    if (y > height - 100) return;

    setTouching(true);
    setCursor(x, y, true);

    const normX = x / width;
    const normY = 1 - (y / (height - 100));

    if (audio.ctx) {
        audio.start(touchId);
        audio.update(normX, Math.max(0, Math.min(1, normY)), touchId);
    }

    activeTouches.set(touchId, { x, y, startTime: Date.now() });
    addRipple(x, y);
}

function handleMove(x, y, touchId, audio) {
    if (!activeTouches.has(touchId)) return;

    const { width, height } = getCanvasSize();

    setCursor(x, y, true);

    const normX = x / width;
    const normY = 1 - (y / (height - 100));

    const touchData = activeTouches.get(touchId);
    const duration = (Date.now() - touchData.startTime) / 1000;

    audio.update(normX, Math.max(0, Math.min(1, normY)), touchId, duration);
    activeTouches.set(touchId, { x, y, startTime: touchData.startTime });

    if (Math.random() > 0.9) addRipple(x, y);
}

function handleEnd(touchId, audio) {
    const touchData = activeTouches.get(touchId);
    const duration = touchData ? (Date.now() - touchData.startTime) / 1000 : 0;

    activeTouches.delete(touchId);
    audio.stop(touchId, duration);

    if (activeTouches.size === 0) {
        setTouching(false);
    }
}

export function initModeSelector(audio) {
    const buttons = document.querySelectorAll('.mode-btn');
    buttons.forEach(btn => {
        const handler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            audio.initMode(btn.dataset.mode);
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('touchend', handler);
    });
}

export function initScaleControls(audio) {
    const tonicSelect = document.getElementById('tonicSelect');
    const scaleSelect = document.getElementById('scaleSelect');

    tonicSelect.addEventListener('change', (e) => {
        audio.setTonic(e.target.value);
    });

    scaleSelect.addEventListener('change', (e) => {
        audio.setScaleType(e.target.value);
    });
}

export function initDeviceOrientation(audio) {
    const needsOrientationPermission = typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function';
    const needsMotionPermission = typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function';

    if (needsOrientationPermission || needsMotionPermission) {
        const promises = [];

        if (needsOrientationPermission) {
            promises.push(
                DeviceOrientationEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
                        }
                        return 'o:' + state;
                    })
                    .catch(err => 'o:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        if (needsMotionPermission) {
            promises.push(
                DeviceMotionEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('devicemotion', e => {
                                const acc = e.acceleration || e.accelerationIncludingGravity;
                                audio.updateMotion(acc, e.rotationRate);
                            }, true);
                        }
                        return 'm:' + state;
                    })
                    .catch(err => 'm:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        Promise.all(promises).then(results => {
            document.getElementById('val-motion').innerText = results.join(' ');
        });
    } else {
        if (typeof DeviceOrientationEvent !== 'undefined') {
            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
        }
        if (typeof DeviceMotionEvent !== 'undefined') {
            window.addEventListener('devicemotion', e => {
                const acc = e.acceleration || e.accelerationIncludingGravity;
                audio.updateMotion(acc, e.rotationRate);
            }, true);
        }
        document.getElementById('val-motion').innerText = 'auto';
    }
}
