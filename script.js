// Basic carrom-style game using only Canvas 2D.
// The code is split into small pieces so beginners can follow the flow:
// - setup and constants
// - drawing the board and pieces
// - physics and collisions
// - user input and aiming
// - main animation loop

const canvas = document.getElementById('carromCanvas');
const ctx = canvas.getContext('2d');
canvas.style.touchAction = "none";

canvas.addEventListener("touchstart", function(e){
e.preventDefault();
}, {passive:false});

canvas.addEventListener("touchmove", function(e){
e.preventDefault();
}, {passive:false});

canvas.addEventListener("touchend", function(e){
e.preventDefault();
}, {passive:false});

const scoreEl = document.getElementById('scoreValue');
const turnEl = document.getElementById('turnValue');
const restartButton = document.getElementById('restartButton');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Board configuration
const margin = 48; // visible inner wooden frame margin
const playLeft = margin;
const playTop = margin;
const playRight = WIDTH - margin;
const playBottom = HEIGHT - margin;
const boardCenter = { x: WIDTH / 2, y: HEIGHT / 2 };

// Pocket configuration
const pocketRadius = 22;
const pocketInnerRadius = 16;

// Coin / striker sizes
const coinRadius = 16;
const strikerRadius = 18;

// Physics configuration
const friction = 0.99; // velocity multiplier each frame (low friction = long glide)
const minSpeedThreshold = 0.05; // below this, object is considered stopped
const wallRestitution = 0.9; // how "bouncy" the frame is (1 = perfectly elastic)
const coinRestitution = 0.94; // energy preserved on coin/coin and striker/coin impacts

// Game state
let coins = [];
let striker = null;
let isAiming = false;
let aimStart = null;
let aimCurrent = null;
let isAnimating = false;
let score = 0;
let currentPlayer = 1;

// --- Simple sound system (no external files) ---
// We generate very short "click" sounds using the Web Audio API
// so there is no need to load audio assets.
let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Play a short percussive blip (used for wall hits, coin hits, pockets)
function playClick(frequency, durationMs, volume) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(volume, now);
  // Exponential decay for a quick, snappy sound
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

// Utility: distance between points
function distance(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

// Create a new circular body
function createBody(x, y, radius, color, isStriker = false) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    color, // base fill color
    isStriker,
    active: true,
    // Properties used for visual effects
    pocketing: false,
    pocketProgress: 0,
    pocketTarget: null,
    startPocketPos: null,
    renderRadius: radius,
    alpha: 1,
    onPocketDone: null,
    hitPulse: 0, // briefly >0 after collisions, used to squash/brighten
  };
}

// Initialize coins in a loose cluster around the center
function createInitialCoins() {
  const c = [];

  // Simple pattern: one in center and ring around
  c.push(createBody(boardCenter.x, boardCenter.y, coinRadius, '#f8f3dc')); // "queen" style

  const ringRadius = coinRadius * 2.1;
  const colors = ['#222222', '#fefefe'];
  const ringCount = 8;
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2;
    const x = boardCenter.x + ringRadius * Math.cos(angle);
    const y = boardCenter.y + ringRadius * Math.sin(angle);
    const color = colors[i % colors.length];
    c.push(createBody(x, y, coinRadius, color));
  }

  return c;
}

// Place striker at bottom center ready to shoot upward
function resetStriker() {
  striker = createBody(boardCenter.x, playBottom - 60, strikerRadius, '#d43b3b', true);
}

function resetGame() {
  coins = createInitialCoins();
  resetStriker();
  score = 0;
  currentPlayer = 1;
  scoreEl.textContent = score.toString();
  turnEl.textContent = `Player ${currentPlayer}`;
  isAiming = false;
  isAnimating = false;
  aimStart = null;
  aimCurrent = null;
}

// Board rendering
function drawBoard() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // === OUTER WOODEN FRAME (thick polished border) ===
  const outerGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  outerGrad.addColorStop(0, '#7a4a21');
  outerGrad.addColorStop(0.4, '#9c6530');
  outerGrad.addColorStop(1, '#5b3617');
  ctx.fillStyle = outerGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Add subtle vignette to sell the depth of the frame
  const vignetteGrad = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    WIDTH * 0.2,
    WIDTH / 2,
    HEIGHT / 2,
    WIDTH * 0.7
  );
  vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Inner bevel line around the frame to separate it from the playing surface
  ctx.save();
  ctx.strokeStyle = 'rgba(25, 14, 6, 0.85)';
  ctx.lineWidth = 10;
  ctx.strokeRect(
    playLeft - 6,
    playTop - 6,
    playRight - playLeft + 12,
    playBottom - playTop + 12
  );
  ctx.restore();

  // === INNER PLAYING SURFACE ===
  const surfWidth = playRight - playLeft;
  const surfHeight = playBottom - playTop;
  const surfaceGrad = ctx.createLinearGradient(playLeft, playTop, playRight, playBottom);
  surfaceGrad.addColorStop(0, '#f7e4c4');
  surfaceGrad.addColorStop(0.5, '#f0d5ac');
  surfaceGrad.addColorStop(1, '#e7c898');

  ctx.fillStyle = surfaceGrad;
  ctx.fillRect(playLeft, playTop, surfWidth, surfHeight);

   // Soft lighting streak across the board
  const lightGrad = ctx.createLinearGradient(playLeft, playTop, playRight, playBottom);
  lightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.46)');
  lightGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)');
  lightGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.02)');
  lightGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lightGrad;
  ctx.fillRect(playLeft, playTop, surfWidth, surfHeight);

  // Inner shadow along the edges of the playing surface for depth
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(playLeft + 4, playTop + 4, surfWidth - 8, surfHeight - 8);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(playLeft + 3, playTop + 3, surfWidth - 6, surfHeight - 6);
  ctx.restore();

  // Inner circle at center
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(150, 90, 50, 0.8)';
  ctx.arc(boardCenter.x, boardCenter.y, 60, 0, Math.PI * 2);
  ctx.stroke();

  // Small cross lines at the center
  ctx.lineWidth = 1.2;
  const crossLen = 18;
  ctx.beginPath();
  ctx.moveTo(boardCenter.x - crossLen, boardCenter.y);
  ctx.lineTo(boardCenter.x + crossLen, boardCenter.y);
  ctx.moveTo(boardCenter.x, boardCenter.y - crossLen);
  ctx.lineTo(boardCenter.x, boardCenter.y + crossLen);
  ctx.stroke();

  // === CORNER POCKETS ===
  const corners = [
    { x: playLeft, y: playTop },
    { x: playRight, y: playTop },
    { x: playLeft, y: playBottom },
    { x: playRight, y: playBottom },
  ];

  corners.forEach((c) => {
    // Soft outer ring that blends into the board
    const ringGrad = ctx.createRadialGradient(
      c.x - 4,
      c.y - 4,
      pocketInnerRadius * 0.4,
      c.x,
      c.y,
      pocketRadius + 6
    );
    ringGrad.addColorStop(0, 'rgba(50, 30, 15, 0.0)');
    ringGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0.5)');
    ringGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.beginPath();
    ctx.fillStyle = ringGrad;
    ctx.arc(c.x, c.y, pocketRadius + 6, 0, Math.PI * 2);
    ctx.fill();

    // Solid black pocket ring
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8, 8, 8, 1)';
    ctx.arc(c.x, c.y, pocketRadius - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Dark inner hole with subtle depth
    const holeGrad = ctx.createRadialGradient(
      c.x,
      c.y - pocketInnerRadius * 0.4,
      pocketInnerRadius * 0.2,
      c.x,
      c.y,
      pocketInnerRadius
    );
    holeGrad.addColorStop(0, 'rgba(35, 20, 10, 0.9)');
    holeGrad.addColorStop(0.6, 'rgba(5, 3, 2, 1)');
    holeGrad.addColorStop(1, 'rgba(0, 0, 0, 1)');

    ctx.beginPath();
    ctx.fillStyle = holeGrad;
    ctx.arc(c.x, c.y, pocketInnerRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Draw a single coin or striker
function drawBody(body) {
  if (!body.active) return;

  ctx.save();

  // Shadow for depth
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  // Slight squash/scale based on recent impacts for a subtle "bounce" feel.
  const impactScale = 1 + (body.hitPulse || 0) * 0.18;
  const r = (body.renderRadius ?? body.radius) * impactScale;
  ctx.ellipse(body.x + 1, body.y + 3, r * 1.05, r * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();

  // Main circle
  const gradient = ctx.createRadialGradient(
    body.x - r * 0.4,
    body.y - r * 0.4,
    r * 0.1,
    body.x,
    body.y,
    r
  );

  const pulse = body.hitPulse || 0;
  gradient.addColorStop(0, lighten(body.color, 0.28 + pulse * 0.25));
  gradient.addColorStop(0.5, lighten(body.color, 0.12 + pulse * 0.18));
  gradient.addColorStop(1, darken(body.color, 0.32));

  ctx.beginPath();
  ctx.globalAlpha = body.alpha ?? 1;
  ctx.fillStyle = gradient;
  ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(40, 40, 40, 0.8)';
  ctx.stroke();

  // Small ring detail
  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.arc(body.x, body.y, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  // Extra glow for striker to make it stand out
  if (body.isStriker) {
    ctx.save();
    ctx.globalAlpha = (body.alpha ?? 1) * 0.9;
    ctx.shadowColor = 'rgba(255, 120, 120, 0.9)';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 180, 180, 0.9)';
    ctx.lineWidth = 3;
    ctx.arc(body.x, body.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// Simple helpers to lighten / darken an RGB hex color
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean.length === 3 ? clean.repeat(2) : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const t = clamp01(1 + amount);
  return `rgb(${Math.round(r * t)}, ${Math.round(g * t)}, ${Math.round(b * t)})`;
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const t = clamp01(1 - amount);
  return `rgb(${Math.round(r * t)}, ${Math.round(g * t)}, ${Math.round(b * t)})`;
}

// Physics update for a body: movement, wall collisions, friction
function updateBody(body) {
  if (!body.active) return;

  // If the coin is currently being "sucked" into a pocket, we run a small
  // easing animation instead of normal physics.
  if (body.pocketing && body.pocketTarget && body.startPocketPos) {
    body.pocketProgress += 0.06; // controls animation speed
    const t = Math.min(body.pocketProgress, 1);
    // Smooth easing (ease-out cubic)
    const eased = 1 - Math.pow(1 - t, 3);

    body.x = body.startPocketPos.x + (body.pocketTarget.x - body.startPocketPos.x) * eased;
    body.y = body.startPocketPos.y + (body.pocketTarget.y - body.startPocketPos.y) * eased;
    body.renderRadius = body.radius * (1 - 0.65 * eased);
    body.alpha = 1 - 0.9 * eased;

    if (t >= 1) {
      body.active = false;
      body.pocketing = false;
      body.pocketTarget = null;
      body.startPocketPos = null;
      body.renderRadius = body.radius;
      body.alpha = 1;
      if (typeof body.onPocketDone === 'function') {
        body.onPocketDone();
      }
    }
    return;
  }

  // Gradually fade the hit pulse used for squeeze animation
  if (body.hitPulse && body.hitPulse > 0.001) {
    body.hitPulse *= 0.82;
  } else if (body.hitPulse) {
    body.hitPulse = 0;
  }

  body.x += body.vx;
  body.y += body.vy;

  // Wall collisions with basic bounce
  if (body.x - body.radius < playLeft) {
    body.x = playLeft + body.radius;
    if (Math.abs(body.vx) > 0.2) {
      body.hitPulse = 1;
      playClick(1400, 70, 0.18);
    }
    body.vx = -body.vx * wallRestitution;
  } else if (body.x + body.radius > playRight) {
    body.x = playRight - body.radius;
    if (Math.abs(body.vx) > 0.2) {
      body.hitPulse = 1;
      playClick(1400, 70, 0.18);
    }
    body.vx = -body.vx * wallRestitution;
  }

  if (body.y - body.radius < playTop) {
    body.y = playTop + body.radius;
    if (Math.abs(body.vy) > 0.2) {
      body.hitPulse = 1;
      playClick(1400, 70, 0.18);
    }
    body.vy = -body.vy * wallRestitution;
  } else if (body.y + body.radius > playBottom) {
    body.y = playBottom - body.radius;
    if (Math.abs(body.vy) > 0.2) {
      body.hitPulse = 1;
      playClick(1400, 70, 0.18);
    }
    body.vy = -body.vy * wallRestitution;
  }

  // Apply friction
  body.vx *= friction;
  body.vy *= friction;

  // Stop very slow movement to avoid endless sliding
  if (Math.abs(body.vx) < minSpeedThreshold) body.vx = 0;
  if (Math.abs(body.vy) < minSpeedThreshold) body.vy = 0;
}

// Check whether all bodies have stopped moving
function allStopped() {
  const movingCoins = coins.some((c) => Math.abs(c.vx) > minSpeedThreshold || Math.abs(c.vy) > minSpeedThreshold);
  const strikerMoving = Math.abs(striker.vx) > minSpeedThreshold || Math.abs(striker.vy) > minSpeedThreshold;
  return !movingCoins && !strikerMoving;
}

// Resolve collision between two circular bodies using simple elastic collision
function resolveCollision(a, b) {
  if (!a.active || !b.active) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius;

  if (dist === 0 || dist > minDist) return;

  // Separate overlapping bodies
  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  a.x -= (overlap / 2) * nx;
  a.y -= (overlap / 2) * ny;
  b.x += (overlap / 2) * nx;
  b.y += (overlap / 2) * ny;

  // Relative normal velocity (along the collision normal)
  const relVel =
    (b.vx - a.vx) * nx +
    (b.vy - a.vy) * ny;

  // If bodies are separating already, no need to resolve
  if (relVel > 0) return;

  // Simple impulse resolution for equal-mass discs using a restitution factor.
  // This keeps collisions feeling snappy but not perfectly elastic.
  const e = coinRestitution;
  const j = (-(1 + e) * relVel) / 2; // divide by 2 because masses are equal

  const impulseX = j * nx;
  const impulseY = j * ny;

  a.vx -= impulseX;
  a.vy -= impulseY;
  b.vx += impulseX;
  b.vy += impulseY;

  // Visual + audio feedback only for stronger hits
  const impactStrength = Math.abs(relVel);
  if (impactStrength > 0.25) {
    a.hitPulse = 1;
    b.hitPulse = 1;
    const freq = 900 + impactStrength * 800;
    const vol = Math.min(0.22 + impactStrength * 0.15, 0.45);
    playClick(freq, 70, vol);
  }
}

// Check if body falls into any pocket
function checkPocket(body) {
  const pockets = [
    { x: playLeft, y: playTop },
    { x: playRight, y: playTop },
    { x: playLeft, y: playBottom },
    { x: playRight, y: playBottom },
  ];

  for (const p of pockets) {
    if (distance(body.x, body.y, p.x, p.y) < pocketInnerRadius) {
      return p;
    }
  }
  return null;
}

// Start the pocket drop animation for a body
function startPocketAnimation(body, pocket, onDone) {
  body.vx = 0;
  body.vy = 0;
  body.pocketing = true;
  body.pocketTarget = pocket;
  body.startPocketPos = { x: body.x, y: body.y };
  body.pocketProgress = 0;
  body.onPocketDone = onDone || null;

  // Slight impact flash and a deeper, lower-pitched sound for pockets
  body.hitPulse = 1;
  const baseFreq = body.isStriker ? 420 : 320;
  playClick(baseFreq, 120, 0.35);
}

// Main animation loop
function loop() {
  requestAnimationFrame(loop);

  drawBoard();

  // Update movement only while pieces are in motion
  if (isAnimating) {
    coins.forEach(updateBody);
    updateBody(striker);

    // Handle collisions between coins and striker
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c.active) continue;

      // Coin / coin collisions
      for (let j = i + 1; j < coins.length; j++) {
        const other = coins[j];
        if (!other.active) continue;
        resolveCollision(c, other);
      }

      // Striker / coin collision
      resolveCollision(c, striker);
    }

    // Check pockets
    coins.forEach((c) => {
      if (!c.active) return;
      const pocket = checkPocket(c);
      if (pocket && !c.pocketing) {
        // Start pocket animation and update score immediately
        startPocketAnimation(c, pocket);
        // Simple scoring: +10 per coin sunk
        score += 10;
        scoreEl.textContent = score.toString();
      }
    });

    // Striker pocketed: reset to starting point
    const strikerPocket = checkPocket(striker);
    if (strikerPocket && !striker.pocketing) {
      startPocketAnimation(striker, strikerPocket, () => {
        resetStriker();
      });
    }

    // Stop animation when all pieces have settled
    if (allStopped()) {
      isAnimating = false;
      resetStriker();
      // Alternate turn after each shot
      currentPlayer = currentPlayer === 1 ? 2 : 1;
      turnEl.textContent = `Player ${currentPlayer}`;
    }
  }

  // Draw active coins
  coins.forEach(drawBody);

  // Draw striker
  drawBody(striker);

  // Draw aiming line while dragging
  if (isAiming && aimStart && aimCurrent) {
    drawAimLine();
  }
}

// Draw the power/aim indicator line
function drawAimLine() {
  const from = { x: striker.x, y: striker.y };
  const to = { x: aimCurrent.x, y: aimCurrent.y };

  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const rawPower = Math.hypot(dx, dy);
  const clampedPower = Math.min(rawPower, MAX_DRAG_DISTANCE); // cap max power

  // Ease-out curve so small drags give fine control and
  // larger drags ramp up smoothly instead of linearly.
  const linearRatio = clampedPower / MAX_DRAG_DISTANCE;
  const powerRatio = Math.pow(linearRatio, 0.8);
  const previewLen = 40 + 80 * powerRatio;

  const angle = Math.atan2(dy, dx);
  const px = striker.x + Math.cos(angle) * previewLen;
  const py = striker.y + Math.sin(angle) * previewLen;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = `rgba(${Math.round(200 + 55 * powerRatio)}, ${Math.round(
    60 + 40 * (1 - powerRatio)
  )}, 60, 0.9)`;

  ctx.beginPath();
  ctx.moveTo(striker.x, striker.y);
  ctx.lineTo(px, py);
  ctx.stroke();

  // Small circle at arrow tip
  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Convert mouse event to canvas-relative coordinates
function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

// Maximum drag distance in pixels (controls maximum power)
const MAX_DRAG_DISTANCE = 160;

// Handle drag updates globally so aiming continues even if the cursor leaves the canvas
function handleGlobalMouseMove(e) {
  if (!isAiming || !aimStart) return;

  // Current mouse position relative to the canvas
  const pos = getMousePos(e);

  // Raw drag vector from striker to mouse
  const dx = pos.x - aimStart.x;
  const dy = pos.y - aimStart.y;
  const dist = Math.hypot(dx, dy);

  if (dist === 0) {
    aimCurrent = { x: aimStart.x, y: aimStart.y };
    return;
  }

  // Clamp drag length so power remains controlled and stable
  const clampedDist = Math.min(dist, MAX_DRAG_DISTANCE);
  const scale = clampedDist / dist;

  aimCurrent = {
    x: aimStart.x + dx * scale,
    y: aimStart.y + dy * scale,
  };
}

// Finish the shot on global mouseup
function handleGlobalMouseUp() {
  if (!isAiming || !aimStart || !aimCurrent) {
    isAiming = false;
    aimStart = null;
    aimCurrent = null;
    document.removeEventListener('mousemove', handleGlobalMouseMove);
    document.removeEventListener('mouseup', handleGlobalMouseUp);
    return;
  }

  // Compute shot direction and power based on drag from striker to aimCurrent
  const dx = aimStart.x - aimCurrent.x;
  const dy = aimStart.y - aimCurrent.y;
  const rawDist = Math.hypot(dx, dy);
  const clampedDist = Math.min(rawDist, MAX_DRAG_DISTANCE);

  if (clampedDist > 4) {
    const maxPower = 18;
    // Same easing as the preview line: more control at lower drag distances.
    const linearRatio = clampedDist / MAX_DRAG_DISTANCE;
    const powerRatio = Math.pow(linearRatio, 0.8);
    const strength = maxPower * powerRatio;
    const angle = Math.atan2(dy, dx);

    striker.vx = Math.cos(angle) * strength;
    striker.vy = Math.sin(angle) * strength;
    isAnimating = true;
  }

  isAiming = false;
  aimStart = null;
  aimCurrent = null;

  // Stop listening once the shot has been taken
  document.removeEventListener('mousemove', handleGlobalMouseMove);
  document.removeEventListener('mouseup', handleGlobalMouseUp);
}

// Input handling: start aim on mousedown near striker (on the canvas),
// but track drag and release using document-level listeners.
canvas.addEventListener('mousedown', (e) => {
  if (isAnimating) return; // do not allow new shot while things are moving

  // Ensure audio context is created after a user gesture (required by browsers)
  ensureAudioContext();

  const pos = getMousePos(e);
  const d = distance(pos.x, pos.y, striker.x, striker.y);

  // Start aiming only if mouse is close to striker
  if (d <= striker.radius + 12) {
    isAiming = true;
    aimStart = { x: striker.x, y: striker.y };
    aimCurrent = { x: pos.x, y: pos.y };

    // Listen on the whole document so drag continues smoothly
    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
  }
});

restartButton.addEventListener('click', () => {
  resetGame();
});

// Boot strap
resetGame();
loop();

