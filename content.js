(() => {
  "use strict";
  if (window.__uniPipInjected) return;
  window.__uniPipInjected = true;

  // ---------------- 图标 ----------------
  const ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.5 7.7a1 1 0 0 0-1.5.86v6.9a1 1 0 0 0 1.5.85l5.9-3.45a1 1 0 0 0 0-1.7L8.5 7.7z"/>
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/>
  </svg>`;
  const CLOSE_X = "✕";
  const MIN_X = "—";

  // ---------------- 追踪所有按钮并同步位置 ----------------
  const buttons = new Set();

  function makeButton(video) {
    if (video.dataset.uniPip) return;
    video.dataset.uniPip = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "uni-pip-btn";
    btn.innerHTML = ICON_SVG;
    btn.title = "画中画";
    btn.setAttribute("aria-label", "画中画");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      togglePip(video);
    });
    btn.addEventListener("mouseover", (e) => e.stopPropagation());
    document.documentElement.appendChild(btn);
    btn._video = video;
    btn._forceHide = true; // 初始隐藏，等待鼠标进入后显示
    btn._hideTimer = null;

    const apply = () => {
      btn.style.display = btn._forceHide ? "none" : "block";
    };
    const show = () => {
      btn._forceHide = false;
      apply();
      clearTimeout(btn._hideTimer);
      btn._hideTimer = setTimeout(() => {
        btn._forceHide = true;
        apply();
      }, 2600);
    };
    video.addEventListener("mousemove", show, { passive: true });
    video.addEventListener("touchstart", show, { passive: true });
    video.addEventListener("mouseleave", () => {
      btn._forceHide = true;
      apply();
    });
    buttons.add(btn);
  }

  function syncPositions() {
    for (const btn of buttons) {
      const v = btn._video;
      const r = v.getBoundingClientRect();
      // 移出视口 / 过小的视频直接隐藏
      const offscreen = r.width < 80 || r.height < 50 || r.bottom < 0 || r.top > innerHeight ||
                        r.right < 0 || r.left > innerWidth;
      if (offscreen) { btn.style.display = "none"; continue; }
      // 可见性统一由 apply()/_forceHide 控制，这里只更新位置
      btn.style.width = "30px";
      btn.style.height = "30px";
      btn.style.left = Math.round(r.left + (r.width - 30) / 2) + "px";
      btn.style.top = Math.round(r.top + 10) + "px";
    }
    requestAnimationFrame(syncPositions);
  }
  requestAnimationFrame(syncPositions);

  // 视频全屏时强制隐藏按钮
  document.addEventListener("fullscreenchange", () => {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    for (const b of buttons) {
      const v = b._video;
      const full = fs && (fs === v || fs.contains(v));
      if (full) {
        clearTimeout(b._hideTimer);
        b._forceHide = true;
      }
      b.style.display = full ? "none" : (b._forceHide ? "none" : "block");
    }
  });
  document.addEventListener("webkitfullscreenchange", () => {
    const fs = document.webkitFullscreenElement;
    if (!fs) return;
    for (const b of buttons) {
      const v = b._video;
      if (fs === v || fs.contains(v)) {
        clearTimeout(b._hideTimer);
        b._forceHide = true;
        b.style.display = "none";
      }
    }
  });

  // ---------------- 主体逻辑 ----------------
  async function togglePip(video) {
    // 1) 已处于原生 PiP → 退出
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
    } catch (e) {}

    // 2) 尝试系统级原生 PiP
    try {
      if ("requestPictureInPicture" in video && document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
        return; // 成功：系统级悬浮小窗
      }
    } catch (err) {
      // 被网站拦截或 API 不可用 → 走兜底
    }

    // 3) 兜底：captureStream 页内小窗
    openWidget(video);
  }

  // ---------------- 页内小窗（兜底方案） ----------------
  let widget = null;

  function openWidget(srcVideo) {
    if (widget) closeWidget();

    const el = document.createElement("div");
    el.className = "uni-pip-widget";

    const bar = document.createElement("div");
    bar.className = "uni-pip-bar";

    const label = document.createElement("span");
    label.textContent = srcVideo.currentSrc || "画中画";

    const minBtn = document.createElement("button");
    minBtn.className = "uni-pip-min";
    minBtn.textContent = MIN_X;
    minBtn.title = "最小化";

    const closeBtn = document.createElement("button");
    closeBtn.className = "uni-pip-close";
    closeBtn.textContent = CLOSE_X;
    closeBtn.title = "关闭";

    bar.append(label, minBtn, closeBtn);

    const v = document.createElement("video");
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = srcVideo.muted;
    v.setAttribute("x5-playsinline", "");

    let streaming = false;
    try {
      if (typeof srcVideo.captureStream === "function") {
        v.srcObject = srcVideo.captureStream();
        streaming = true;
      }
    } catch (e) {}
    if (!streaming) {
      v.src = srcVideo.currentSrc || srcVideo.src || "";
      // 尝试同步起播
      if (!srcVideo.paused) v.play().catch(() => {});
    }

    // 镜像源视频的播放/暂停/音量（小窗只是"取景器"）
    const onPlay = () => !v.paused && v.play().catch(() => {});
    const onPause = () => v.pause();
    const onVol = () => (v.muted = srcVideo.muted);
    srcVideo.addEventListener("play", onPlay);
    srcVideo.addEventListener("pause", onPause);
    srcVideo.addEventListener("volumechange", onVol);
    el._handlers = { onPlay, onPause, onVol, srcVideo };

    el.append(bar, v);
    document.documentElement.appendChild(el);
    widget = el;
    widget._src = srcVideo;

    // 拖动移动小窗
    let drag = null;
    bar.addEventListener("mousedown", (e) => {
      drag = { x: e.clientX, y: e.clientY, ol: el.offsetLeft, ot: el.offsetTop };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      el.style.left = drag.ol + (e.clientX - drag.x) + "px";
      el.style.top = drag.ot + (e.clientY - drag.y) + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => (drag = null));

    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = v.style.display === "none";
      v.style.display = hidden ? "block" : "none";
      minBtn.textContent = hidden ? MIN_X : "□";
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWidget();
    });
  }

  function closeWidget() {
    if (!widget) return;
    const { onPlay, onPause, onVol, srcVideo } = widget._handlers || {};
    if (srcVideo) {
      srcVideo.removeEventListener("play", onPlay);
      srcVideo.removeEventListener("pause", onPause);
      srcVideo.removeEventListener("volumechange", onVol);
    }
    widget.remove();
    widget = null;
  }

  // ---------------- 监听动态加入的视频 ----------------
  function scan() {
    document.querySelectorAll("video").forEach(makeButton);
  }
  function observe() {
    scan();
    const mo = new MutationObserver((muts) => {
      if (muts.some((m) => m.addedNodes.length)) scan();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pageshow", scan);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe, { once: true });
  } else {
    observe();
  }
})();
