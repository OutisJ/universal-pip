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

  // Track videos, buttons and the pointer independently of the site's overlays.
  const records = new Set();
  const knownVideos = new WeakMap();
  let pointer = null;

  function rectContains(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function isFullscreen(video) {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    return !!fs && (fs === video || fs.contains(video));
  }

  function isVisible(rect) {
    return rect.width >= 80 && rect.height >= 50 && rect.bottom > 0 &&
           rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }

  // Hover previews tend to be muted and stop as soon as the pointer leaves.
  // Wait for an intentional interaction or playback that persists off-hover.
  function isPlayer(record, rect) {
    const video = record.video;
    return video.controls || record.engaged || record.persistent ||
           (!video.muted && rect.width >= 640 && rect.height >= 360) ||
           (!video.muted && !video.paused && rect.width >= 320 && rect.height >= 180);
  }

  function hide(record) {
    clearTimeout(record.hideTimer);
    record.button.classList.add("uni-pip-hide");
  }

  function show(record) {
    record.button.classList.remove("uni-pip-hide");
    clearTimeout(record.hideTimer);
    record.hideTimer = setTimeout(() => hide(record), 2600);
  }

  function checkPersistentPlayback(record) {
    clearTimeout(record.playTimer);
    if (record.video.paused || record.persistent) return;
    record.playTimer = setTimeout(() => {
      const video = record.video;
      if (!video.isConnected || video.paused) return;
      const rect = video.getBoundingClientRect();
      if (!pointer || !rectContains(rect, pointer.x, pointer.y)) {
        record.persistent = true;
      }
    }, 400);
  }

  function makeButton(video) {
    if (knownVideos.has(video) || video.closest(".uni-pip-widget")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "uni-pip-btn uni-pip-hide";
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
    const record = {
      video, button: btn, engaged: false, persistent: false,
      hovered: false, hideTimer: null, playTimer: null, abort: new AbortController()
    };
    knownVideos.set(video, record);
    records.add(record);
    video.addEventListener("play", () => checkPersistentPlayback(record), { signal: record.abort.signal });
    video.addEventListener("pause", () => clearTimeout(record.playTimer), { signal: record.abort.signal });
    document.documentElement.appendChild(btn);
    if (!video.paused) checkPersistentPlayback(record);
  }

  function syncPositions() {
    for (const record of records) {
      const { video, button: btn } = record;
      if (!video.isConnected) {
        record.abort.abort();
        clearTimeout(record.hideTimer);
        clearTimeout(record.playTimer);
        btn.remove();
        records.delete(record);
        knownVideos.delete(video);
        continue;
      }
      const r = video.getBoundingClientRect();
      const visible = isVisible(r) && !isFullscreen(video);
      btn.style.display = visible ? "block" : "none";
      if (!visible) { record.hovered = false; hide(record); continue; }
      btn.style.width = "30px";
      btn.style.height = "30px";
      btn.style.left = Math.round(r.left + (r.width - 30) / 2) + "px";
      btn.style.top = Math.round(r.top + 10) + "px";
    }
    requestAnimationFrame(syncPositions);
  }
  requestAnimationFrame(syncPositions);

  // Capture pointer events above the video even when a player overlay covers it.
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    for (const record of records) {
      const rect = record.video.getBoundingClientRect();
      const hovered = isVisible(rect) && !isFullscreen(record.video) &&
                      rectContains(rect, pointer.x, pointer.y);
      if (hovered && isPlayer(record, rect)) show(record);
      else if (record.hovered) hide(record);
      if (record.hovered && !hovered) checkPersistentPlayback(record);
      record.hovered = hovered;
    }
  }, true);
  document.addEventListener("pointerdown", (event) => {
    for (const record of records) {
      const rect = record.video.getBoundingClientRect();
      if (!isVisible(rect) || !rectContains(rect, event.clientX, event.clientY)) continue;
      // A click on a muted, control-free card is usually navigation, not player use.
      if (!record.video.controls && record.video.muted &&
          (rect.width < 640 || rect.height < 360)) continue;
      record.engaged = true;
      if (!isFullscreen(record.video)) show(record);
    }
  }, true);

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
