/* ============================================================
   Mu's Planet —— 主交互脚本
   模块: 粒子(canvas) / 留声机+音频分析 / 点灯人 / 小王子 / 终端
   ============================================================ */
(() => {
  'use strict';

  /* ---------- 共享音频状态 --------------------------------- */
  // 由留声机点击时初始化；粒子模块每帧读取 audioLevel
  const audio = {
    ctx: null,
    analyser: null,
    freq: null,
    wired: false,
    bass: 0,   // 0~1
    mid:  0,   // 0~1
    treb: 0,   // 0~1，高频
    energy: 0, // 0~1，总能量（平滑包络，驱动整体呼吸）
    beat: 0    // 0~1，柔和的鼓点脉冲
  };

  function wireAudio(el) {
    if (audio.wired) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio.ctx = new Ctx();
      const src = audio.ctx.createMediaElementSource(el);
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 512;
      audio.analyser.smoothingTimeConstant = 0.85;
      audio.freq = new Uint8Array(audio.analyser.frequencyBinCount);
      src.connect(audio.analyser);
      audio.analyser.connect(audio.ctx.destination);
      audio.wired = true;
    } catch (err) {
      console.warn('[mu] AudioContext 初始化失败：', err);
    }
  }

  function sampleAudio() {
    if (!audio.analyser) return;
    audio.analyser.getByteFrequencyData(audio.freq);
    let b = 0, m = 0, t = 0;
    for (let i = 0; i < 10;  i++) b += audio.freq[i];
    for (let i = 10; i < 60; i++) m += audio.freq[i];
    for (let i = 60; i < 160; i++) t += audio.freq[i];
    const bassRaw = (b / 10)  / 255;
    const midRaw  = (m / 50)  / 255;
    const trebRaw = (t / 100) / 255;
    // 各频段独立低通：跟随能量包络，不跟瞬时波形
    audio.bass = audio.bass * 0.88 + bassRaw * 0.12;
    audio.mid  = audio.mid  * 0.88 + midRaw  * 0.12;
    audio.treb = audio.treb * 0.88 + trebRaw * 0.12;
    // 总能量（更慢的包络，整页呼吸用）
    const totalRaw = (bassRaw * 0.5 + midRaw * 0.35 + trebRaw * 0.15);
    audio.energy = audio.energy * 0.94 + totalRaw * 0.06;
    // beat：bass 高能量时柔和上升，缓慢衰减
    if (audio.bass > 0.45) audio.beat = Math.min(1, audio.beat + 0.08);
    audio.beat *= 0.94;
    document.documentElement.style.setProperty('--audio-energy', audio.energy.toFixed(3));
  }

  /* ---------- 1. 粒子系统 (canvas) ------------------------- */
  // 三层星尘：dust (微尘，多)、stars (中等)、bright (大且闪烁)
  // 颜色：~70% 冷白蓝 + ~25% 暖金黄 + ~5% 玫瑰粉
  // 偶发流星
  function initParticles() {
    const canvas = document.getElementById('particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];
    let hoveringSelection = false;
    let frame = 0;

    const PALETTE = [
      { r: 207, g: 214, b: 255, weight: 0.55 }, // 冷白蓝
      { r: 232, g: 236, b: 255, weight: 0.20 }, // 纯白
      { r: 255, g: 210, b: 122, weight: 0.18 }, // 暖金（萤火）
      { r: 247, g: 139, b: 178, weight: 0.07 }  // 玫瑰粉
    ];
    function pickColor() {
      const r = Math.random();
      let acc = 0;
      for (const c of PALETTE) { acc += c.weight; if (r < acc) return c; }
      return PALETTE[0];
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((W * H) / 8500);
      const n = Math.max(120, Math.min(260, target));
      if (particles.length < n) {
        while (particles.length < n) particles.push(spawn());
      } else { particles.length = n; }
    }

    function spawn() {
      // 三类粒子：dust 60%、stars 32%、bright 8%
      const roll = Math.random();
      const tier = roll < 0.6 ? 'dust' : (roll < 0.92 ? 'star' : 'bright');
      const radius =
        tier === 'dust'   ? 0.3 + Math.random() * 0.7 :
        tier === 'star'   ? 0.8 + Math.random() * 1.2 :
                            1.6 + Math.random() * 1.4;
      const baseAlpha =
        tier === 'dust'   ? 0.15 + Math.random() * 0.25 :
        tier === 'star'   ? 0.35 + Math.random() * 0.4  :
                            0.6  + Math.random() * 0.35;
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: radius,
        a: baseAlpha,
        tier,
        color: pickColor(),
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.005 + Math.random() * 0.02
      };
    }

    function step() {
      requestAnimationFrame(step);
      sampleAudio();
      frame++;

      const bass   = audio.bass;
      const mid    = audio.mid;
      const beat   = audio.beat;
      const energy = audio.energy;
      // 整体流速：随能量包络温和加速，不再瞬时跳变
      const speedK = hoveringSelection ? 0.3 : (1 + energy * 1.6);

      // 拖尾效果：能量高时拖尾更长，整体显得更"流动"
      const trailAlpha = 0.16 + (1 - energy) * 0.14;
      ctx.fillStyle = `rgba(6, 8, 24, ${trailAlpha})`;
      ctx.fillRect(0, 0, W, H);

      // 粒子绘制
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.vx += (Math.random() - 0.5) * 0.035;
        p.vy += (Math.random() - 0.5) * 0.035;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.x += p.vx * speedK;
        p.y += p.vy * speedK;

        if (p.x < -5) p.x = W + 5;
        else if (p.x > W + 5) p.x = -5;
        if (p.y < -5) p.y = H + 5;
        else if (p.y > H + 5) p.y = -5;

        // 闪烁
        p.twinklePhase += p.twinkleSpeed;
        const twinkle = p.tier === 'dust' ? 1 : (0.6 + 0.4 * Math.sin(p.twinklePhase));

        // 亮度与半径只跟随能量包络，柔和呼吸
        const alpha  = Math.min(1, p.a * twinkle + energy * 0.35);
        const radius = p.r * (1 + energy * 0.6 + beat * 0.25);
        const c = p.color;

        // bright 粒子带柔和外晕
        if (p.tier === 'bright') {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 4);
          glow.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.5})`);
          glow.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 连线
      const linkOn = hoveringSelection || beat > 0.25;
      if (linkOn) {
        const maxDist = hoveringSelection ? 130 : 110;
        const baseOpacity = hoveringSelection ? 0.22 : beat * 0.4;
        ctx.lineWidth = 0.7;
        for (let i = 0; i < particles.length; i++) {
          const a = particles[i];
          if (a.tier === 'dust') continue;        // dust 不参与连线
          for (let j = i + 1; j < particles.length; j++) {
            const b = particles[j];
            if (b.tier === 'dust') continue;
            const dx = a.x - b.x, dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < maxDist * maxDist) {
              const t = 1 - Math.sqrt(d2) / maxDist;
              ctx.strokeStyle = `rgba(220, 220, 255, ${baseOpacity * t})`;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }

    }

    const selection = document.getElementById('selection');
    if (selection) {
      selection.addEventListener('mouseenter', () => { hoveringSelection = true; });
      selection.addEventListener('mouseleave', () => { hoveringSelection = false; });
    }
    window.addEventListener('resize', resize);
    resize();
    step();
  }

  /* ---------- 2. 黑胶留声机 -------------------------------- */
  function initVinyl() {
    const btn = document.getElementById('vinyl');
    const audioEl = document.getElementById('bgm');
    if (!btn || !audioEl) return;

    audioEl.addEventListener('error', () => {
      console.warn('[mu] 音频加载失败：检查 darwi.mp3 是否存在 (建议用 http server 而非 file:// 打开)');
    });

    btn.addEventListener('click', async () => {
      if (audioEl.paused) {
        try {
          wireAudio(audioEl);
          if (audio.ctx && audio.ctx.state === 'suspended') await audio.ctx.resume();
          await audioEl.play();
          btn.classList.add('playing');
          btn.setAttribute('aria-pressed', 'true');
        } catch (err) {
          console.warn('[mu] 播放失败：', err);
        }
      } else {
        audioEl.pause();
        btn.classList.remove('playing');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
    audioEl.addEventListener('ended', () => btn.classList.remove('playing'));
  }

  /* ---------- 3. 点灯人导航（点击切换 section） ------------- */
  function initLamplighter() {
    const lamps = document.querySelectorAll('.lamp');
    const sections = document.querySelectorAll('main > section');
    const scroller = document.getElementById('scroller');
    if (!lamps.length || !sections.length) return;

    const idToLamp = {};
    const idToSection = {};
    lamps.forEach(a => { idToLamp[a.getAttribute('href').slice(1)] = a; });
    sections.forEach(s => { idToSection[s.id] = s; });

    function activate(id, { updateHash = true } = {}) {
      const section = idToSection[id];
      if (!section) return;
      sections.forEach(s => s.classList.toggle('is-active', s === section));
      lamps.forEach(l => l.classList.toggle('active', idToLamp[id] === l));
      // 切换后回到顶部，单 section 内独立滚动
      if (scroller) scroller.scrollTop = 0;
      if (updateHash) {
        history.replaceState(null, '', '#' + id);
      }
    }

    lamps.forEach(lamp => {
      lamp.addEventListener('click', (e) => {
        e.preventDefault();
        const id = lamp.getAttribute('href').slice(1);
        activate(id);
      });
    });

    // 支持地址栏 hash 直达 + 浏览器前进后退
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (idToSection[id]) activate(id, { updateHash: false });
    });

    const initial = location.hash.slice(1);
    activate(idToSection[initial] ? initial : 'origins', { updateHash: false });
  }

  /* ---------- 4. 小王子闲置动画 ---------------------------- */
  function initPrinceIdle() {
    const prince = document.getElementById('little-prince');
    const nav = document.getElementById('lamplighter');
    if (!prince) return;

    const IDLE_MS = 5000;
    let timer = null;
    const wake = () => {
      prince.classList.remove('gazing');
      nav && nav.classList.remove('glow-up');
      clearTimeout(timer);
      timer = setTimeout(() => {
        prince.classList.add('gazing');
        nav && nav.classList.add('glow-up');
      }, IDLE_MS);
    };
    ['mousemove', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
      window.addEventListener(ev, wake, { passive: true })
    );
    const scroller = document.getElementById('scroller');
    scroller && scroller.addEventListener('scroll', wake, { passive: true });
    wake();
  }

  /* ---------- 5. 星际终端 ---------------------------------- */
  function initTerminal() {
    const term  = document.getElementById('terminal');
    const log   = document.getElementById('terminal-log');
    const input = document.getElementById('terminal-input');
    if (!term || !log || !input) return;

    const writeLine = (text, cls) => {
      const line = document.createElement('div');
      if (cls) line.className = cls;
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    };
    const writeBlock = lines => lines.forEach(l => writeLine(l));

    const banner = [
      "Mu's Planet · interactive console v0.1",
      "Type 'help' to list available commands.",
      ''
    ];
    const handlers = {
      help: () => writeBlock([
        'Available commands:',
        '  help            列出可用命令',
        '  whois           研究身份简介',
        '  tools           AI 工作流栈',
        '  download --cv   下载简历 (占位)',
        '  clear           清空日志',
        ''
      ]),
      whois: () => writeBlock([
        'Mu — PhD researcher at SUSTech Business School.',
        'Focus: Behavioral & Experimental Economics, Belief Updating,',
        '       Game Theory, Bayesian Inference.',
        'Stack: oTree · Stata · Python · LaTeX.',
        ''
      ]),
      tools: () => writeBlock([
        '[ AI workflow status ]',
        '  claude-code         online   · primary coding agent',
        '  openclaw            online   · experiment orchestration',
        '  otree               local    · experiment runtime',
        '  stata               batch    · data cleaning',
        '  zotero + latex      synced   · writing pipeline',
        ''
      ]),
      'download --cv': () => {
        writeLine('CV download requested... (占位：尚未配置 cv.pdf)', 'out-cmd');
        writeLine('TODO: 把 cv.pdf 放到项目根目录后，此命令将触发真实下载。');
        writeLine('');
      },
      clear: () => { log.innerHTML = ''; }
    };

    const run = raw => {
      const cmd = raw.trim();
      if (!cmd) return;
      writeLine(`mu@planet:~$ ${cmd}`, 'out-cmd');
      const fn = handlers[cmd];
      if (fn) fn();
      else {
        writeLine(`command not found: ${cmd}`, 'out-err');
        writeLine("Type 'help' for available commands.");
        writeLine('');
      }
    };

    const toggle = () => {
      const isHidden = term.hasAttribute('hidden');
      if (isHidden) {
        term.removeAttribute('hidden');
        if (!log.childNodes.length) writeBlock(banner);
        requestAnimationFrame(() => term.classList.add('open'));
        setTimeout(() => input.focus(), 350);
      } else {
        term.classList.remove('open');
        setTimeout(() => term.setAttribute('hidden', ''), 350);
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.key !== '`') return;
      e.preventDefault();
      toggle();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { run(input.value); input.value = ''; }
      else if (e.key === 'Escape') toggle();
    });
  }

  /* ---------- 启动 ----------------------------------------- */
  function boot() {
    initParticles();
    initVinyl();
    initLamplighter();
    initPrinceIdle();
    initTerminal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
