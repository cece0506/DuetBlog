(function () {
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    return;
  }

  if (document.querySelector(".pencil-cursor") || document.querySelector(".cursor-effects")) {
    return;
  }

  var COLORS = ["#ff8ea1", "#ffcf6e", "#66e3d3", "#6e93ff", "#ff91de"];

  var cursor = document.createElement("div");
  cursor.className = "pencil-cursor";
  cursor.innerHTML = '<span class="pencil-tip"></span><span class="pencil-eraser"></span>';

  var canvas = document.createElement("canvas");
  canvas.className = "cursor-effects";

  document.body.append(canvas, cursor);
  document.body.classList.add("custom-cursor-active");

  var context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return;
  }

  var pointerX = window.innerWidth / 2;
  var pointerY = window.innerHeight / 2;
  var lastWaveStamp = 0;
  var frame = 0;
  var running = false;
  var rafId = 0;

  var waves = [];
  var stars = [];
  var rings = [];
  var pointerHistory = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function setCursorPosition(clientX, clientY) {
    pointerX = clientX;
    pointerY = clientY;
    cursor.style.left = pointerX + "px";
    cursor.style.top = pointerY + "px";
    cursor.classList.add("is-visible");
  }

  function startAnimation() {
    if (running) {
      return;
    }
    running = true;
    rafId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    running = false;
    cancelAnimationFrame(rafId);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function createWave(intensity) {
    var points = pointerHistory.slice(-10);
    if (points.length < 4) {
      return;
    }

    waves.push({
      points: points,
      life: 0,
      maxLife: 84,
      amplitude: 3 + intensity * 1.6,
      wavelength: 5 + intensity * 2,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[(waves.length + intensity) % COLORS.length],
    });
    startAnimation();
  }

  function createStars() {
    for (var i = 0; i < 10; i += 1) {
      var angle = Math.PI * 2 * i / 10 + Math.random() * 0.3;
      var speed = 2.4 + Math.random() * 2.4;
      stars.push({
        x: pointerX,
        y: pointerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.16,
        size: 3.5 + Math.random() * 5,
        color: COLORS[i % COLORS.length],
        life: 0,
        maxLife: 34 + Math.floor(Math.random() * 8),
      });
    }
    startAnimation();
  }

  function createScrollRings(delta) {
    var count = Math.min(3, Math.max(1, Math.round(Math.abs(delta) / 140)));
    for (var i = 0; i < count; i += 1) {
      rings.push({
        x: pointerX,
        y: pointerY,
        radius: 10 + i * 4,
        growth: 1.4 + i * 0.4,
        color: COLORS[(i + Math.floor(Math.random() * 5)) % COLORS.length],
        life: 0,
        maxLife: 28 + i * 8,
      });
    }
    startAnimation();
  }

  function drawStar(star, alpha) {
    context.save();
    context.translate(star.x, star.y);
    context.rotate(star.rotation);
    context.beginPath();
    for (var p = 0; p < 5; p += 1) {
      var outer = Math.PI * 2 * p / 5 - Math.PI / 2;
      var inner = outer + Math.PI / 5;
      var outerX = Math.cos(outer) * star.size * alpha;
      var outerY = Math.sin(outer) * star.size * alpha;
      var innerX = Math.cos(inner) * star.size * alpha * 0.48;
      var innerY = Math.sin(inner) * star.size * alpha * 0.48;
      if (p === 0) {
        context.moveTo(outerX, outerY);
      } else {
        context.lineTo(outerX, outerY);
      }
      context.lineTo(innerX, innerY);
    }
    context.closePath();
    context.fillStyle = star.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
    context.shadowBlur = 12;
    context.shadowColor = star.color;
    context.fill();
    context.restore();
  }

  function drawWave(wave, progress, alpha) {
    context.beginPath();
    var wobble = wave.amplitude * alpha;
    for (var i = 0; i < wave.points.length; i += 1) {
      var point = wave.points[i];
      var next = wave.points[Math.min(i + 1, wave.points.length - 1)];
      var vx = next.x - point.x;
      var vy = next.y - point.y;
      var length = Math.max(1, Math.hypot(vx, vy));
      var nx = -vy / length;
      var ny = vx / length;
      var offset = Math.sin(i / wave.wavelength + wave.phase + progress * 6) * wobble;
      var x = point.x + nx * offset;
      var y = point.y + ny * offset;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = wave.color + Math.round(alpha * 175).toString(16).padStart(2, "0");
    context.lineWidth = 1.9 - progress * 0.7;
    context.lineCap = "round";
    context.shadowBlur = 8;
    context.shadowColor = wave.color;
    context.stroke();
  }

  function animate() {
    frame += 1;
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (var wi = waves.length - 1; wi >= 0; wi -= 1) {
      var wave = waves[wi];
      wave.life += 1;
      if (wave.life >= wave.maxLife) {
        waves.splice(wi, 1);
        continue;
      }
      var progress = wave.life / wave.maxLife;
      drawWave(wave, progress, 1 - progress);
    }

    for (var ri = rings.length - 1; ri >= 0; ri -= 1) {
      var ring = rings[ri];
      ring.life += 1;
      if (ring.life >= ring.maxLife) {
        rings.splice(ri, 1);
        continue;
      }
      var ringAlpha = 1 - ring.life / ring.maxLife;
      ring.radius += ring.growth;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      context.strokeStyle = ring.color + Math.round(ringAlpha * 180).toString(16).padStart(2, "0");
      context.lineWidth = 1.8;
      context.stroke();
    }

    for (var si = stars.length - 1; si >= 0; si -= 1) {
      var star = stars[si];
      star.life += 1;
      if (star.life >= star.maxLife) {
        stars.splice(si, 1);
        continue;
      }
      var alpha = 1 - star.life / star.maxLife;
      star.x += star.vx;
      star.y += star.vy;
      star.vy += 0.03;
      star.rotation += star.spin;
      drawStar(star, alpha);
    }

    if (waves.length === 0 && stars.length === 0 && rings.length === 0) {
      stopAnimation();
      return;
    }

    rafId = requestAnimationFrame(animate);
  }

  resizeCanvas();
  setCursorPosition(pointerX, pointerY);

  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("pointermove", function (event) {
    setCursorPosition(event.clientX, event.clientY);
    pointerHistory.push({ x: event.clientX, y: event.clientY });
    if (pointerHistory.length > 14) {
      pointerHistory.shift();
    }
    var now = performance.now();
    if (now - lastWaveStamp > 64) {
      createWave(1 + frame % 3);
      lastWaveStamp = now;
    }
  }, { passive: true });

  document.addEventListener("pointerenter", function (event) {
    setCursorPosition(event.clientX, event.clientY);
    pointerHistory.length = 0;
  }, { passive: true });

  document.addEventListener("pointerdown", function () {
    createStars();
  });

  document.addEventListener("wheel", function (event) {
    createScrollRings(event.deltaY);
  }, { passive: true });

  document.querySelectorAll("a, button, .post-card, .gallery-bubble, .tool-card, .glance-card, .calendar-post-link")
    .forEach(function (element) {
      element.addEventListener("mouseenter", function () {
        cursor.style.transform = "translate(-50%, -50%) rotate(-12deg) scale(1.14)";
      });
      element.addEventListener("mouseleave", function () {
        cursor.style.transform = "translate(-50%, -50%) rotate(-24deg) scale(1)";
      });
    });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      return;
    }
    stopAnimation();
    waves.splice(0, waves.length);
    stars.splice(0, stars.length);
    rings.splice(0, rings.length);
  });
})();
