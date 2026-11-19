/* Cubli 遥控调试终端 - 前端逻辑 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);

  /* 只在值变化时写 DOM，避免元素反复重排导致点击不稳定 */
  function setText(el, v) {
    if (el && el.textContent !== v) el.textContent = v;
  }
  function setClass(el, cls, on) {
    if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  // ---------------- 本地状态 ----------------
  const state = { wx: 0, wy: 0, wz: 0, raw: false, ch0: 128, ch1: 128, ch2: 128 };
  let streaming = false;
  let dirty = false;
  let lastPush = 0;
  const MAXR = 300;

  // ---------------- 请求封装 ----------------
  async function api(path, body) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      return await res.json();
    } catch (e) {
      console.error(path, e);
      return { ok: false };
    }
  }

  // ---------------- 状态推送（节流 50ms） ----------------
  function pushState(force) {
    const now = Date.now();
    if (!force && now - lastPush < 50) { dirty = true; return; }
    lastPush = now;
    dirty = false;
    api("/api/state", state);
  }

  // ---------------- 三轴滑杆 ----------------
  const sldX = $("#sldX"), sldY = $("#sldY"), sldZ = $("#sldZ");
  const outX = $("#outX"), outY = $("#outY"), outZ = $("#outZ");

  function fmt(v) {
    return (v >= 0 ? "+" : "") + Number(v).toFixed(1);
  }
  function renderAxis() {
    setText(outX, fmt(state.wx));
    setText(outY, fmt(state.wy));
    setText(outZ, fmt(state.wz));
    if (document.activeElement !== sldX) sldX.value = state.wx;
    if (document.activeElement !== sldY) sldY.value = state.wy;
    if (document.activeElement !== sldZ) sldZ.value = state.wz;
  }
  function bindSlider(el, key) {
    el.addEventListener("input", () => {
      state[key] = parseFloat(el.value);
      renderAxis();
      pushState();
    });
  }
  bindSlider(sldX, "wx");
  bindSlider(sldY, "wy");
  bindSlider(sldZ, "wz");

  // ---------------- 键盘控制 ----------------
  const KEYS = {
    KeyA: ["wx", -MAXR], KeyD: ["wx", MAXR],
    KeyW: ["wy", MAXR], KeyS: ["wy", -MAXR],
    KeyQ: ["wz", -MAXR], KeyE: ["wz", MAXR],
  };
  const pressed = new Set();

  function applyKeys() {
    state.wx = 0; state.wy = 0; state.wz = 0;
    pressed.forEach((code) => {
      const k = KEYS[code];
      if (!k) return;
      state[k[0]] += k[1];
    });
    state.wx = Math.max(-MAXR, Math.min(MAXR, state.wx));
    state.wy = Math.max(-MAXR, Math.min(MAXR, state.wy));
    state.wz = Math.max(-MAXR, Math.min(MAXR, state.wz));
    renderAxis();
    pushState(true);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.target.tagName === "INPUT") return;
    if (ev.code === "Space") { ev.preventDefault(); fireCmd("stop"); return; }
    if (ev.code === "Escape") { ev.preventDefault(); resetNeutral(); return; }
    if (!KEYS[ev.code]) return;
    ev.preventDefault();
    pressed.add(ev.code);
    applyKeys();
  });

  window.addEventListener("keyup", (ev) => {
    if (!KEYS[ev.code]) return;
    pressed.delete(ev.code);
    applyKeys();
  });

  // ---------------- 指令按钮 ----------------
  document.querySelectorAll(".cmd").forEach((btn) => {
    btn.addEventListener("click", () => fireCmd(btn.dataset.cmd));
  });

  async function fireCmd(name) {
    const btn = document.querySelector('.cmd[data-cmd="' + name + '"]');
    const r = await api("/api/cmd", { cmd: name });
    if (r.ok && btn) {
      btn.classList.add("pulse");
      setTimeout(() => btn.classList.remove("pulse"), 180);
    }
  }

  function resetNeutral() {
    state.wx = state.wy = state.wz = 0;
    state.ch0 = state.ch1 = state.ch2 = 128;
    renderAxis();
    syncRawUI();
    pushState(true);
    api("/api/reset", {});
  }

  // ---------------- 直通模式 ----------------
  const chkRaw = $("#chkRaw");
  const rawBox = $("#rawBox");
  const RAW = [["rCh0", "oCh0", "ch0"], ["rCh1", "oCh1", "ch1"], ["rCh2", "oCh2", "ch2"]];

  chkRaw.addEventListener("change", () => {
    state.raw = chkRaw.checked;
    rawBox.hidden = !state.raw;
    pushState(true);
  });

  RAW.forEach((row) => {
    const el = $("#" + row[0]), out = $("#" + row[1]), key = row[2];
    el.addEventListener("input", () => {
      state[key] = parseInt(el.value, 10);
      setText(out, el.value);
      pushState();
    });
  });

  function syncRawUI() {
    RAW.forEach((row) => {
      $("#" + row[0]).value = state[row[2]];
      setText($("#" + row[1]), String(state[row[2]]));
    });
  }

  // ---------------- 启停 ----------------
  const btnStream = $("#btnStream");
  btnStream.addEventListener("click", async () => {
    const target = !streaming;
    const r = await api("/api/enable", { enabled: target });
    if (r.ok) {
      streaming = !!r.enabled;
      renderStreamBtn();
    }
  });

  function renderStreamBtn() {
    setText(btnStream, streaming ? "停止发送" : "启动发送");
    setClass(btnStream, "stop", streaming);
  }

  // ---------------- 配置 ----------------
  $("#btnApply").addEventListener("click", async () => {
    await api("/api/config", {
      esp32_ip: $("#inIp").value.trim(),
      esp32_port: parseInt($("#inPort").value, 10),
      send_hz: parseInt($("#inHz").value, 10),
    });
  });

  $("#btnPing").addEventListener("click", () => api("/api/ping", {}));
  $("#btnReset").addEventListener("click", resetNeutral);

  // ---------------- 状态轮询 ----------------
  const pillStream = $("#pillStream");
  const pillAck = $("#pillAck");
  const pillErr = $("#pillErr");

  function setInput(el, v) {
    if (el && document.activeElement !== el && el.value !== String(v)) {
      el.value = v;
    }
  }

  async function poll() {
    let r;
    try {
      r = await fetch("/api/status").then((x) => x.json());
    } catch (e) {
      console.error("status", e);
      return;
    }

    streaming = !!r.enabled;
    renderStreamBtn();

    setText(pillStream, "STREAM " + (streaming ? "ON" : "OFF"));
    setClass(pillStream, "on", streaming);

    setText(pillAck, "ACK " + r.acks);
    setClass(pillAck, "on", r.acks > 0 && r.ack_age_ms >= 0 && r.ack_age_ms < 2000);

    setText(pillErr, "ERR " + r.errs);
    setClass(pillErr, "bad", r.errs > 0);

    setText($("#kvAddr"), r.cfg.esp32_ip + ":" + r.cfg.esp32_port);
    setText($("#kvSent"), String(r.sent));
    setText($("#kvAcks"), String(r.acks));
    setText($("#kvSeq"), String(r.seq));
    setText($("#kvLat"), r.ack_age_ms >= 0 ? r.ack_age_ms + " ms" : "—");

    setInput($("#inIp"), r.cfg.esp32_ip);
    setInput($("#inPort"), r.cfg.esp32_port);
    setInput($("#inHz"), r.cfg.send_hz);

    const box = $("#logBox");
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
    const txt = r.log.join("\n");
    if (box.textContent !== txt) {
      box.textContent = txt;
      if (atBottom) box.scrollTop = box.scrollHeight;
    }
  }

  setInterval(() => {
    if (dirty || streaming) pushState(true);
  }, 200);

  setInterval(poll, 700);

  // 初始化
  renderAxis();
  syncRawUI();
  renderStreamBtn();
  pushState(true);
  poll();
})();
