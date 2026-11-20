// ============================================================
// MÓDULO ÚNICO Y DEFINITIVO - CREDICUPO EXPRESS
// Cada botón estrictamente a lo suyo (sin subbotones de salto)
// ============================================================
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function iniciarCrediCupoExtras() {
  let ownerProofDataUrl = "";
  let currentApproveLoanId = null;
  let knownSig = null;
  let clientKnownSig = null;
  let selectedActiveLoanId = null;
  let restaurandoCfg = false;
  let activeRuleTab = "datos_app";
  let activeClientTab = "paga_cuota";
  let clientTabInitializedFor = null;
  let isSyncing = false;

  const NOMBRES_10_NIVELES = [
    "Burusa", "Basurita", "Piedrita", "Grava", "Cerro",
    "Roca", "Cantera", "Montaña", "Cordillera", "Everest"
  ];

  // ------------------------------------------------------------
  // 0. UTILIDADES: COPIAR, REGLA REAL Y RESPALDO BLINDADO TOTAL
  // ------------------------------------------------------------
  window.ccCopyText = async (txt, label) => {
    const clean = String(txt || "").trim();
    if (!clean) return;
    try {
      await navigator.clipboard.writeText(clean);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = clean;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    if (window.CC && window.CC.showToast) {
      window.CC.showToast(`📋 ${label || "Copiado"}: ${clean}`);
    }
  };

  function getRealLevelData(lvl) {
    if (!window.CC || !window.CC.state) return null;
    const cfg = window.CC.state.cfg || {};
    const levels = Array.isArray(cfg.levels) ? cfg.levels : [];
    const r = levels.find(item => Number(item?.lvl || item?.level) === Number(lvl)) || levels[lvl - 1] || {};

    const candidatos = [r.pct, r.interest, r.rate, r.int, r.porcentaje, r.ganancia, cfg.interest, cfg.pct];
    let interest = 0;
    for (const val of candidatos) {
      const n = Number(val);
      if (!isNaN(n) && n > 0) {
        interest = n;
        break;
      }
    }
    if (interest <= 0) interest = 23;

    return {
      lvl,
      level: lvl,
      name: r.name || NOMBRES_10_NIVELES[lvl - 1] || `Nivel ${lvl}`,
      amount: Number(r.amount) || 0,
      interest,
      quotas: Number(r.quotas) || 1,
      freq: r.freq || "semanal"
    };
  }

  async function guardarParcialBlindado(parcheObj) {
    if (!window.CC || !window.CC.db || !window.CC.state) return;
    const { db, state } = window.CC;
    const cfgActualizado = { ...(state.cfg || {}), ...parcheObj };
    state.cfg = cfgActualizado;

    await setDoc(doc(db, "credicupo", "config"), cfgActualizado, { merge: true });

    const { rate, ...datosFijos } = cfgActualizado;
    await setDoc(doc(db, "credicupo", "backup_config"), {
      ...datosFijos,
      updatedAt: Date.now()
    }, { merge: true });
  }

  // ------------------------------------------------------------
  // A. TIMBRE + BANNER + TELEGRAM (DUEÑO Y CLIENTE)
  // ------------------------------------------------------------
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notas = [987.77, 1318.51, 987.77, 1318.51, 1567.98];
      notas.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + idx * 0.16;
        gain.gain.setValueAtTime(1.0, t0);
        gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.34);
      });
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 450]);
    } catch (e) {}
  }

  function showSystemBanner(title, body) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, vibrate: [300, 100, 300] });
      }
    } catch (e) {}
  }

  window.sendTelegramToChat = async (targetChatId, htmlText) => {
    if (!window.CC || !window.CC.state) return;
    const token = (window.CC.state.cfg?.tgBotToken || "").trim();
    const chatId = String(targetChatId || "").trim();
    if (!token || !chatId) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: "HTML"
        })
      });
    } catch (err) {}
  };

  window.sendOwnerTelegramAlert = async (htmlText, plainTitle, plainBody) => {
    if (plainTitle) showSystemBanner(plainTitle, plainBody || "");
    const ownerChatId = window.CC?.state?.cfg?.tgOwnerChatId;
    await window.sendTelegramToChat(ownerChatId, htmlText);
  };

  window.sendClientTelegramAlert = async (cedula, title, body) => {
    if (!window.CC || !window.CC.state) return;
    const u = window.CC.state.users[cedula];
    if (!u || !u.tgChatId) return;
    await window.sendTelegramToChat(u.tgChatId, `<b>${title}</b>\n${body}`);
  };

  function getCurrentTelegramUserId() {
    try {
      const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      return id ? String(id) : "";
    } catch (e) {
      return "";
    }
  }

  // ------------------------------------------------------------
  // B. MÉTODOS DE COBRO DEL CLIENTE EN REGISTRO
  // ------------------------------------------------------------
  const bankSel = document.getElementById("regBank");
  if (bankSel && !Array.from(bankSel.options).some(o => o.value === "Venezolano de Crédito (0104)")) {
    const optBvc = document.createElement("option");
    optBvc.value = "Venezolano de Crédito (0104)";
    optBvc.textContent = "Banco Venezolano de Crédito (0104)";
    bankSel.insertBefore(optBvc, bankSel.firstChild);
  }

  const methodSel = document.getElementById("regMethod");
  const binBox = document.getElementById("regBinBox");
  const pmBox = document.getElementById("regPmBox");

  if (methodSel && binBox && pmBox && !methodSel.dataset.extraEnhanced) {
    methodSel.dataset.extraEnhanced = "1";
    methodSel.innerHTML = `
      <option value="pm">Pago Móvil (Bs. a tasa BCV)</option>
      <option value="bvc_full">Banco Venezolano de Crédito (0104) • PM y/o Correo</option>
      <option value="ubii">UBII PAGO • Correo / Teléfono</option>
      <option value="binance">Binance Pay (USDT)</option>
    `;

    const customBox = document.createElement("div");
    customBox.id = "regCustomPayBox";
    customBox.className = "hidden";
    customBox.innerHTML = `
      <div id="bvcFieldsWrap" class="hidden">
        <label>Teléfono Pago Móvil BVC (opcional)</label>
        <input type="tel" id="regBvcPhone" placeholder="04141234567">
        <div class="grid-2">
          <div>
            <label>Cédula titular BVC</label>
            <input type="tel" id="regBvcCedula" placeholder="26417372">
          </div>
          <div>
            <label>Correo BVC (opcional)</label>
            <input type="email" id="regBvcMail" placeholder="tucorreo@gmail.com">
          </div>
        </div>
      </div>

      <div id="ubiiFieldsWrap" class="hidden">
        <label>Correo electrónico registrado en UBII PAGO</label>
        <input type="email" id="regUbiiMail" placeholder="tucorreo@gmail.com">
        <div class="grid-2">
          <div>
            <label>Teléfono UBII PAGO (opcional)</label>
            <input type="tel" id="regUbiiPhone" placeholder="04141234567">
          </div>
          <div>
            <label>Cédula titular</label>
            <input type="tel" id="regUbiiCedula" placeholder="26417372">
          </div>
        </div>
      </div>
    `;
    binBox.parentNode.insertBefore(customBox, binBox.nextSibling);

    window.toggleRegMethod = () => {
      const m = methodSel.value;
      pmBox.classList.toggle("hidden", m !== "pm");
      binBox.classList.toggle("hidden", m !== "binance");
      customBox.classList.toggle("hidden", m !== "bvc_full" && m !== "ubii");
      document.getElementById("bvcFieldsWrap").classList.toggle("hidden", m !== "bvc_full");
      document.getElementById("ubiiFieldsWrap").classList.toggle("hidden", m !== "ubii");
    };

    window.registerClient = async () => {
      if (!window.CC) return;
      const { db, state, showToast, refreshUI } = window.CC;

      const nombre = document.getElementById("regNombre").value.trim();
      const cedula = document.getElementById("regCedula").value.replace(/\D/g, "");
      const phone = document.getElementById("regPhone").value.trim();
      const pin = document.getElementById("regPin").value.trim();
      const method = methodSel.value;
      const idPhoto = document.getElementById("regIdPreview")?.src;
      const hasPhoto = idPhoto && !document.getElementById("regIdPreview").classList.contains("hidden");

      if (!nombre || cedula.length < 6 || !phone || pin.length !== 4) {
        return showToast("Completa todos los datos y PIN de 4 números");
      }
      if (state.users[cedula]) {
        return showToast("Esa cédula ya está registrada. Inicia sesión.");
      }
      if (!hasPhoto) {
        return showToast("Debes subir la foto de tu cédula");
      }

      let payInfo = "";
      if (method === "pm") {
        const bank = document.getElementById("regBank").value;
        const pmPhone = document.getElementById("regPmPhone").value.trim();
        const pmCed = document.getElementById("regPmCedula").value.replace(/\D/g, "");
        if (!pmPhone || !pmCed) return showToast("Completa los datos de tu Pago Móvil");
        payInfo = `${bank} • ${pmPhone} • V-${pmCed}`;
      } else if (method === "bvc_full") {
        const bvcPhone = document.getElementById("regBvcPhone").value.trim();
        const bvcCed = document.getElementById("regBvcCedula").value.replace(/\D/g, "");
        const bvcMail = document.getElementById("regBvcMail").value.trim();
        if (!bvcPhone && !bvcMail) return showToast("Escribe tu teléfono o correo de Venezolano de Crédito");
        const parts = ["BVC (0104)"];
        if (bvcPhone) parts.push(`PM: ${bvcPhone}`);
        if (bvcCed) parts.push(`V-${bvcCed}`);
        if (bvcMail) parts.push(`Correo: ${bvcMail}`);
        payInfo = parts.join(" • ");
      } else if (method === "ubii") {
        const ubiiMail = document.getElementById("regUbiiMail").value.trim();
        const ubiiPhone = document.getElementById("regUbiiPhone").value.trim();
        const ubiiCed = document.getElementById("regUbiiCedula").value.replace(/\D/g, "");
        if (!ubiiMail && !ubiiPhone) return showToast("Escribe tu correo o teléfono de UBII PAGO");
        const parts = ["UBII PAGO"];
        if (ubiiMail) parts.push(`Correo: ${ubiiMail}`);
        if (ubiiPhone) parts.push(`Tel: ${ubiiPhone}`);
        if (ubiiCed) parts.push(`V-${ubiiCed}`);
        payInfo = parts.join(" • ");
      } else {
        const bin = document.getElementById("regBinId").value.trim();
        if (!bin) return showToast("Escribe tu correo o ID de Binance");
        payInfo = `Binance Pay: ${bin}`;
      }

      const tgChatId = getCurrentTelegramUserId();
      const userObj = {
        nombre, cedula, phone, pin, method, payInfo, idPhoto,
        tgChatId, canEditProfile: false, editRequestNote: "",
        level: 1, paidCount: 0, blocked: false, blockReason: "",
        createdAt: Date.now()
      };

      showToast("Creando cuenta...");
      await setDoc(doc(db, "users", cedula), userObj);
      state.currentUserCedula = cedula;
      localStorage.setItem("cc_session_cedula", cedula);
      showToast("¡Cuenta creada con éxito!");
      refreshUI();
    };
  }

  // ------------------------------------------------------------
  // C. MENÚ MODULAR EN VISTA DEL CLIENTE (CADA BOTÓN A LO SUYO)
  // ------------------------------------------------------------
  function setHiddenSafe(el, shouldHide) {
    if (!el) return;
    if (shouldHide) {
      if (!el.classList.contains("hidden")) el.classList.add("hidden");
    } else {
      if (el.classList.contains("hidden")) el.classList.remove("hidden");
    }
  }

  window.selectClientMenuTab = (tabKey) => {
    activeClientTab = tabKey;
    applyClientMenuVisibility(true);
    if (tabKey === "pedir_otro" && typeof window.updateExtraLoanCalc === "function") {
      window.updateExtraLoanCalc();
    }
  };

  function applyClientMenuVisibility(force = false) {
    if (!window.CC || !window.CC.state) return;
    const { state } = window.CC;
    const viewClient = document.getElementById("viewClient");
    if (!viewClient || viewClient.classList.contains("hidden") || !state.currentUserCedula) return;

    const u = state.users[state.currentUserCedula];
    if (!u) return;

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === state.currentUserCedula);
    const activeLoans = myLoans
      .filter(l => ["activo", "pagando"].includes(l.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    const hasPending = myLoans.some(l => l.status === "pendiente");

    if (clientTabInitializedFor !== u.cedula) {
      clientTabInitializedFor = u.cedula;
      activeClientTab = (activeLoans.length > 0 || hasPending) ? "paga_cuota" : "pedir_credito";
    }

    // 1. Barra de 7 botones debajo de la tarjeta azul
    let navWrap = document.getElementById("clientModularNavCard");
    const heroCard = viewClient.querySelector(".hero-card, .card");
    if (!navWrap) {
      navWrap = document.createElement("div");
      navWrap.id = "clientModularNavCard";
      navWrap.className = "card";
      navWrap.style.padding = "12px";
      if (heroCard && heroCard.nextSibling) {
        viewClient.insertBefore(navWrap, heroCard.nextSibling);
      } else {
        viewClient.appendChild(navWrap);
      }
    }

    const navSig = `${activeClientTab}|${activeLoans.length}|${hasPending ? 1 : 0}`;
    if (force || navWrap.dataset.navSig !== navSig) {
      navWrap.dataset.navSig = navSig;
      const btnStyle = (key, extra = "") => {
        const activo = activeClientTab === key;
        return `${extra}background:${activo ? "#00875A" : "#111827"};color:#FFFFFF;border:1px solid ${activo ? "#00875A" : "#1F2937"};border-radius:12px;font-weight:800;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,0.12);line-height:1.2;text-align:center;`;
      };

      navWrap.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <button type="button" onclick="selectClientMenuTab('pedir_credito')"
            style="${btnStyle('pedir_credito', 'padding:14px 8px;font-size:15px;')}">
            Pedir<br>Crédito
          </button>
          <button type="button" onclick="selectClientMenuTab('paga_cuota')"
            style="${btnStyle('paga_cuota', 'padding:14px 8px;font-size:15px;')}">
            Paga tu<br>cuota
          </button>
          <button type="button" onclick="selectClientMenuTab('pedir_otro')"
            style="${btnStyle('pedir_otro', 'padding:12px 8px;font-size:13px;')}">
            Pedir otro<br>crédito
          </button>
          <button type="button" onclick="selectClientMenuTab('datos_cuentas')"
            style="${btnStyle('datos_cuentas', 'padding:12px 8px;font-size:13px;')}">
            Tus datos<br>Y cuentas
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:8px;margin-bottom:8px;">
          <button type="button" onclick="selectClientMenuTab('niveles')"
            style="${btnStyle('niveles', 'padding:10px 8px;font-size:13px;')}">
            Niveles
          </button>
          <button type="button" onclick="selectClientMenuTab('niveles_anterior')"
            style="${btnStyle('niveles_anterior', 'padding:10px 8px;font-size:13px;')}">
            Niveles anterior
          </button>
        </div>

        <button type="button" onclick="selectClientMenuTab('terminos')"
          style="${btnStyle('terminos', 'width:100%;padding:11px 10px;font-size:13px;')}">
          Términos y condiciones
        </button>
      `;
    }

    // 2. Secciones de la vista cliente
    const reqBox = document.getElementById("cliRequestLoanBox") || document.getElementById("reqQuotaSelect")?.closest(".card");
    const actBox = document.getElementById("cliActiveLoanBox");
    const extraCard = document.getElementById("cliExtraParallelCard");
    const payCard = document.getElementById("cliEditPayMethodCard");
    const levelsCard = document.getElementById("cliLevelsList")?.closest(".card");
    const histCard = document.getElementById("cliHistoryList")?.closest(".card");

    let infoHelperCard = document.getElementById("cliModularHelperCard");
    if (!infoHelperCard) {
      infoHelperCard = document.createElement("div");
      infoHelperCard.id = "cliModularHelperCard";
      infoHelperCard.className = "card hidden";
      viewClient.appendChild(infoHelperCard);
    }

    const showReq = activeClientTab === "pedir_credito" && activeLoans.length === 0 && !hasPending && !!reqBox;
    const showAct = activeClientTab === "paga_cuota" && !!actBox && (activeLoans.length > 0 || hasPending);
    const showExtra = activeClientTab === "pedir_otro" && !!extraCard && activeLoans.length === 1 && !u.blocked;
    const showPay = activeClientTab === "datos_cuentas" && !!payCard;
    const showLevels = activeClientTab === "niveles" && !!levelsCard;
    const showHist = activeClientTab === "niveles_anterior" && !!histCard;

    setHiddenSafe(reqBox, !showReq);
    setHiddenSafe(actBox, !showAct);
    setHiddenSafe(extraCard, !showExtra);
    setHiddenSafe(payCard, !showPay);
    setHiddenSafe(levelsCard, !showLevels);
    setHiddenSafe(histCard, !showHist);

    if (showLevels && levelsCard) {
      setHiddenSafe(document.getElementById("cliLevelsList"), false);
      // Ocultar el botón interno "Ver / Ocultar" para que la lista salga limpia directo
      levelsCard.querySelectorAll("button").forEach(btn => {
        if (/ver|ocultar/i.test(btn.textContent || "")) {
          setHiddenSafe(btn, true);
        }
      });
    }
    if (showExtra) {
      setHiddenSafe(document.getElementById("extraParallelForm"), false);
    }

    const needsHelper =
      (activeClientTab === "pedir_credito" && !showReq) ||
      (activeClientTab === "paga_cuota" && !showAct) ||
      (activeClientTab === "pedir_otro" && !showExtra) ||
      activeClientTab === "terminos";

    setHiddenSafe(infoHelperCard, !needsHelper);

    // Cada botón muestra exclusivamente su contenido o su aviso limpio, sin subbotones de salto
    if (needsHelper) {
      const helperSig = `${activeClientTab}|${activeLoans.length}|${hasPending ? 1 : 0}|${state.cfg?.termsText || ""}`;
      if (force || infoHelperCard.dataset.helperSig !== helperSig) {
        infoHelperCard.dataset.helperSig = helperSig;
        if (activeClientTab === "pedir_credito") {
          infoHelperCard.innerHTML = `
            <h3 class="card-title">💸 Solicitud de Crédito Principal</h3>
            <div class="alert alert-info" style="margin-bottom:0;font-size:12px;">
              ${hasPending
                ? "⏳ Ya tienes una solicitud principal en revisión por el administrador."
                : "✅ Ya tienes un crédito principal activo en curso."}
            </div>
          `;
        } else if (activeClientTab === "paga_cuota") {
          infoHelperCard.innerHTML = `
            <h3 class="card-title">💳 Paga tu Cuota</h3>
            <div class="alert alert-info" style="margin-bottom:0;font-size:12px;">
              No tienes cuotas pendientes por pagar en este momento.
            </div>
          `;
        } else if (activeClientTab === "pedir_otro") {
          let msg = "Para solicitar un crédito adicional debes tener primero tu crédito principal activo.";
          if (activeLoans.length >= 2) {
            msg = "⛔ Ya alcanzaste el límite máximo de 2 créditos activos simultáneos.";
          } else if (hasPending) {
            msg = "⏳ Ya tienes una solicitud pendiente en revisión por el administrador.";
          }
          infoHelperCard.innerHTML = `
            <h3 class="card-title">➕ Pedir Otro Crédito</h3>
            <div class="alert alert-warn" style="margin-bottom:0;font-size:12px;">${msg}</div>
          `;
        } else if (activeClientTab === "terminos") {
          const terms = (state.cfg?.termsText || "Al solicitar un crédito en CrediCupo Express aceptas pagar tus cuotas puntualmente en las fechas acordadas.").trim();
          infoHelperCard.innerHTML = `
            <h3 class="card-title">📜 Términos y Condiciones</h3>
            <div style="font-size:12px;line-height:1.5;color:#1E293B;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;padding:12px;white-space:pre-line;">${terms}</div>
          `;
        }
      }
    }
  }

  // ------------------------------------------------------------
  // D. PANEL MODULAR EN "EDITAR REGLAS" (DUEÑO)
  // ------------------------------------------------------------
  window.selectRuleSection = (secKey) => {
    activeRuleTab = secKey;
    const oldWrap = document.getElementById("modularRulesWrapper");
    if (oldWrap) oldWrap.remove();
    renderModularRulesPanel(true);
  };

  window.renumerarNivelesMod = () => {
    document.querySelectorAll(".mod-level-card").forEach((card, i) => {
      const titleEl = card.querySelector("strong");
      if (titleEl) titleEl.textContent = `Nivel ${i + 1}`;
    });
  };

  window.agregarNivelMod = () => {
    const cont = document.getElementById("modLevelsContainer");
    if (!cont) return;
    const idx = cont.querySelectorAll(".mod-level-card").length;
    const nombreSugerido = NOMBRES_10_NIVELES[idx] || `Nivel ${idx + 1}`;
    const div = document.createElement("div");
    div.className = "mod-level-card";
    div.style.cssText = "background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;padding:10px;margin-bottom:8px;";
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
        <strong style="font-size:13px;color:#0F172A;">Nivel ${idx + 1}</strong>
        <button type="button" class="btn btn-sm btn-danger" style="margin-top:0;padding:4px 8px;font-size:11px;"
          onclick="this.closest('.mod-level-card').remove();window.renumerarNivelesMod();">
          🗑️ Eliminar
        </button>
      </div>
      <label style="margin-top:0;">Nombre del Nivel</label>
      <input type="text" class="mod-lvl-name" value="${nombreSugerido}">
      <div class="grid-2">
        <div>
          <label>Monto ($ USD)</label>
          <input type="number" step="0.01" class="mod-lvl-amt" value="${(idx + 1) * 5}">
        </div>
        <div>
          <label>Interés (%)</label>
          <input type="number" step="0.5" class="mod-lvl-pct" value="23">
        </div>
      </div>
      <div class="grid-2">
        <div>
          <label>Cuotas máx.</label>
          <input type="number" min="1" max="24" class="mod-lvl-quotas" value="2">
        </div>
        <div>
          <label>Frecuencia</label>
          <select class="mod-lvl-freq">
            <option value="semanal" selected>Semanal (7d)</option>
            <option value="quincenal">Quincenal (15d)</option>
          </select>
        </div>
      </div>
    `;
    cont.appendChild(div);
  };

  window.saveModularRuleSection = async (secKey) => {
    if (!window.CC || !window.CC.state) return;
    const { state, showToast } = window.CC;
    const c = state.cfg || {};

    try {
      if (secKey === "datos_app") {
        const appName = (document.getElementById("modAppName")?.value || c.appName || "CrediCupo Express").trim();
        const adminPin = (document.getElementById("modAdminPin")?.value || c.adminPin || "").trim();
        if (!adminPin || adminPin.length < 4) return showToast("El Código Maestro debe tener al menos 4 dígitos");
        await guardarParcialBlindado({ appName, adminPin });
        showToast("✅ Datos de la app guardados");
      } else if (secKey === "ajustes_gen") {
        const lateFeePct = Number(document.getElementById("modLateFee")?.value ?? c.lateFeePct ?? 5);
        const graceDays = Number(document.getElementById("modGraceDays")?.value ?? c.graceDays ?? 1);
        await guardarParcialBlindado({ lateFeePct, graceDays });
        showToast("✅ Ajustes generales guardados");
      } else if (secKey === "pago_movil") {
        const ownerPm = (document.getElementById("modOwnerPm")?.value || "").trim();
        if (!ownerPm) return showToast("Escribe los datos de tu Pago Móvil");
        await guardarParcialBlindado({ ownerPm });
        showToast("✅ Pago Móvil guardado y blindado");
      } else if (secKey === "ubii_pagos") {
        const ownerUbii = (document.getElementById("modOwnerUbii")?.value || "").trim();
        await guardarParcialBlindado({ ownerUbii });
        showToast("✅ UBII PAGO guardado y blindado");
      } else if (secKey === "prorroga") {
        const extDailyPct = Number(document.getElementById("modExtDailyPct")?.value ?? 4);
        await guardarParcialBlindado({ extDailyPct });
        showToast("✅ % de prórroga guardado");
      } else if (secKey === "notificaciones") {
        if ("Notification" in window && Notification.permission === "default") {
          try { await Notification.requestPermission(); } catch (e) {}
        }
        const tgBotToken = (document.getElementById("modTgToken")?.value || "").trim();
        const tgOwnerChatId = (document.getElementById("modTgChatId")?.value || "").trim();
        await guardarParcialBlindado({ tgBotToken, tgOwnerChatId });
        showToast("✅ Notificaciones guardadas y blindadas");
      } else if (secKey === "niveles") {
        const cards = document.querySelectorAll(".mod-level-card");
        const nuevosNiveles = [];
        cards.forEach((card, idx) => {
          const name = (card.querySelector(".mod-lvl-name")?.value || `Nivel ${idx + 1}`).trim();
          const amount = Number(card.querySelector(".mod-lvl-amt")?.value || 0);
          const pct = Number(card.querySelector(".mod-lvl-pct")?.value || 23);
          const quotas = Number(card.querySelector(".mod-lvl-quotas")?.value || 1);
          const freq = card.querySelector(".mod-lvl-freq")?.value || "semanal";
          nuevosNiveles.push({
            lvl: idx + 1,
            level: idx + 1,
            name,
            amount,
            pct,
            interest: pct,
            quotas,
            freq
          });
        });
        if (nuevosNiveles.length === 0) return showToast("Debe haber al menos 1 nivel");
        await guardarParcialBlindado({ levels: nuevosNiveles });
        const oldWrap = document.getElementById("modularRulesWrapper");
        if (oldWrap) oldWrap.remove();
        renderModularRulesPanel(true);
        showToast(`✅ ${nuevosNiveles.length} niveles guardados y blindados`);
      } else if (secKey === "tasa_bcv") {
        const rate = Number(document.getElementById("modBcvRate")?.value || 0);
        if (rate <= 0) return showToast("Ingresa una tasa BCV válida");
        await guardarParcialBlindado({ rate });
        showToast(`✅ Tasa BCV actualizada a Bs. ${rate.toFixed(2)}`);
      } else if (secKey === "whatsapp") {
        const ownerWa = (document.getElementById("modOwnerWa")?.value || "").replace(/\D/g, "");
        await guardarParcialBlindado({ ownerWa });
        showToast("✅ WhatsApp de soporte guardado");
      } else if (secKey === "cupos") {
        const dailyLimit = Number(document.getElementById("modDailyLimit")?.value || 3);
        const loansPerLevel = Number(document.getElementById("modLoansPerLevel")?.value || 5);
        await guardarParcialBlindado({ dailyLimit, loansPerLevel });
        showToast("✅ Reglas de cupos guardadas");
      } else if (secKey === "capital") {
        const initialCapital = Number(document.getElementById("modCapital")?.value || 0);
        await guardarParcialBlindado({ initialCapital });
        showToast("✅ Capital base guardado");
      } else if (secKey === "terminos") {
        const termsText = (document.getElementById("modTermsText")?.value || "").trim();
        await guardarParcialBlindado({ termsText });
        showToast("✅ Términos y condiciones guardados");
      }
    } catch (e) {
      showToast("⚠️ Error al guardar, revisa tu conexión");
    }
  };

  function renderModularRulesPanel(forceRebuild = false) {
    if (!window.CC || !window.CC.state || !window.CC.state.isAdmin) return;
    const cfgPane = document.getElementById("admPaneCfg");
    if (!cfgPane || cfgPane.classList.contains("hidden")) return;

    const existingWrap = document.getElementById("modularRulesWrapper");
    if (existingWrap && existingWrap.contains(document.activeElement)) {
      return;
    }

    Array.from(cfgPane.children).forEach(ch => {
      if (ch.id !== "modularRulesWrapper") {
        setHiddenSafe(ch, true);
      }
    });

    if (existingWrap && !forceRebuild && existingWrap.dataset.renderedTab === activeRuleTab) {
      return;
    }

    const wrap = existingWrap || document.createElement("div");
    wrap.id = "modularRulesWrapper";
    wrap.className = "card";
    wrap.dataset.renderedTab = activeRuleTab;
    if (!existingWrap) {
      cfgPane.appendChild(wrap);
    }

    const c = window.CC.state.cfg || {};
    const botones = [
      ["datos_app", "Datos de la app"],
      ["ajustes_gen", "Ajustes generales"],
      ["pago_movil", "Pago móvil"],
      ["ubii_pagos", "Ubii pagos"],
      ["prorroga", "% prórroga"],
      ["notificaciones", "Notificaciones"],
      ["niveles", "Niveles"],
      ["tasa_bcv", "Tasa BCV"],
      ["whatsapp", "WhatsApp"],
      ["cupos", "Cupos"],
      ["capital", "Capital"],
      ["terminos", "Términos y condiciones"]
    ];

    const gridBtnsHtml = botones.map(([key, label]) => {
      const activo = activeRuleTab === key;
      const fullWidth = key === "terminos" ? "grid-column: 1 / -1;" : "";
      return `
        <button type="button" onclick="selectRuleSection('${key}')"
          style="${fullWidth}padding:10px 8px;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;border:1px solid ${activo ? "#00875A" : "#CBD5E1"};background:${activo ? "#00875A" : "#111827"};color:#FFFFFF;box-shadow:0 2px 4px rgba(0,0,0,0.08);">
          ${label}
        </button>
      `;
    }).join("");

    let bodyHtml = "";

    if (activeRuleTab === "datos_app") {
      bodyHtml = `
        <h3 class="card-title">📱 Datos de la App</h3>
        <label>Nombre de la aplicación</label>
        <input type="text" id="modAppName" value="${c.appName || "CrediCupo Express"}">
        <label>Código Maestro de Dueño (PIN)</label>
        <input type="text" id="modAdminPin" value="${c.adminPin || ""}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('datos_app')">💾 Guardar Datos de la App</button>
      `;
    } else if (activeRuleTab === "ajustes_gen") {
      bodyHtml = `
        <h3 class="card-title">⚙️ Ajustes Generales</h3>
        <label>Mora por atraso (%)</label>
        <input type="number" step="0.5" id="modLateFee" value="${c.lateFeePct ?? 5}">
        <label>Días de gracia antes de mora</label>
        <input type="number" id="modGraceDays" value="${c.graceDays ?? 1}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('ajustes_gen')">💾 Guardar Ajustes Generales</button>
      `;
    } else if (activeRuleTab === "pago_movil") {
      bodyHtml = `
        <h3 class="card-title">🏦 Pago Móvil del Dueño</h3>
        <label>Banco • Cédula • Teléfono</label>
        <input type="text" id="modOwnerPm" value="${c.ownerPm || ""}" placeholder="BDV (0102) • V-26417372 • 04126985783">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('pago_movil')">💾 Guardar Pago Móvil</button>
      `;
    } else if (activeRuleTab === "ubii_pagos") {
      bodyHtml = `
        <h3 class="card-title">📲 UBII PAGO del Dueño</h3>
        <label>Correo o Teléfono registrado en UBII PAGO</label>
        <input type="text" id="modOwnerUbii" value="${c.ownerUbii || ""}" placeholder="willy161198@gmail.com">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('ubii_pagos')">💾 Guardar UBII PAGO</button>
      `;
    } else if (activeRuleTab === "prorroga") {
      bodyHtml = `
        <h3 class="card-title">⏳ Porcentaje de Prórroga</h3>
        <label>Recargo por cada día de prórroga (% diario, máx. 5 días)</label>
        <input type="number" step="0.5" id="modExtDailyPct" value="${c.extDailyPct ?? 4}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('prorroga')">💾 Guardar % de Prórroga</button>
      `;
    } else if (activeRuleTab === "notificaciones") {
      bodyHtml = `
        <h3 class="card-title">🔔 Notificaciones Tipo Cashea</h3>
        <label>Token del Bot (@BotFather)</label>
        <input type="text" id="modTgToken" value="${c.tgBotToken || ""}" placeholder="9100956059:AAG...">
        <label>Tu Chat ID de Telegram (@userinfobot)</label>
        <input type="tel" id="modTgChatId" value="${c.tgOwnerChatId || ""}" placeholder="8851780047">
        <div class="grid-2" style="margin-top:8px;">
          <button type="button" class="btn btn-primary" style="margin-top:0;" onclick="saveModularRuleSection('notificaciones')">💾 Guardar Alertas</button>
          <button type="button" class="btn btn-secondary" style="margin-top:0;" onclick="testTgNotif()">🔔 Probar Alerta</button>
        </div>
      `;
    } else if (activeRuleTab === "niveles") {
      const levelsArr = (Array.isArray(c.levels) && c.levels.length > 0)
        ? c.levels
        : NOMBRES_10_NIVELES.map((n, i) => ({
            lvl: i + 1,
            level: i + 1,
            name: n,
            amount: i === 0 ? 1 : (i + 1) * 5,
            pct: 23,
            quotas: i < 2 ? 1 : 2,
            freq: "semanal"
          }));

      const rowsHtml = levelsArr.map((lvlObj, idx) => {
        const nombreNivel = lvlObj.name || NOMBRES_10_NIVELES[idx] || `Nivel ${idx + 1}`;
        const amt = lvlObj.amount ?? 1;
        const pct = lvlObj.pct ?? lvlObj.interest ?? 23;
        const quotas = lvlObj.quotas ?? 1;
        const freq = lvlObj.freq || "semanal";
        return `
          <div class="mod-level-card" style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;padding:10px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
              <strong style="font-size:13px;color:#0F172A;">Nivel ${idx + 1}</strong>
              <button type="button" class="btn btn-sm btn-danger" style="margin-top:0;padding:4px 8px;font-size:11px;"
                onclick="this.closest('.mod-level-card').remove();window.renumerarNivelesMod();">
                🗑️ Eliminar
              </button>
            </div>
            <label style="margin-top:0;">Nombre del Nivel</label>
            <input type="text" class="mod-lvl-name" value="${nombreNivel}">
            <div class="grid-2">
              <div>
                <label>Monto ($ USD)</label>
                <input type="number" step="0.01" class="mod-lvl-amt" value="${amt}">
              </div>
              <div>
                <label>Interés (%)</label>
                <input type="number" step="0.5" class="mod-lvl-pct" value="${pct}">
              </div>
            </div>
            <div class="grid-2">
              <div>
                <label>Cuotas máx.</label>
                <input type="number" min="1" max="24" class="mod-lvl-quotas" value="${quotas}">
              </div>
              <div>
                <label>Frecuencia</label>
                <select class="mod-lvl-freq">
                  <option value="semanal" ${freq === "semanal" ? "selected" : ""}>Semanal (7d)</option>
                  <option value="quincenal" ${freq === "quincenal" ? "selected" : ""}>Quincenal (15d)</option>
                </select>
              </div>
            </div>
          </div>
        `;
      }).join("");

      bodyHtml = `
        <h3 class="card-title">🏆 Configurar Niveles</h3>
        <div id="modLevelsContainer">${rowsHtml}</div>
        <button type="button" class="btn btn-secondary" style="width:100%;margin-bottom:8px;" onclick="window.agregarNivelMod()">
          ➕ Agregar Nuevo Nivel
        </button>
        <button type="button" class="btn btn-primary" style="width:100%;" onclick="saveModularRuleSection('niveles')">
          💾 Guardar Todos los Niveles
        </button>
      `;
    } else if (activeRuleTab === "tasa_bcv") {
      bodyHtml = `
        <h3 class="card-title">💵 Tasa BCV (Bs. por $1 USD)</h3>
        <label>Tasa actual en Bolívares</label>
        <input type="number" step="0.01" id="modBcvRate" value="${c.rate || ""}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('tasa_bcv')">💾 Guardar Tasa BCV</button>
      `;
    } else if (activeRuleTab === "whatsapp") {
      bodyHtml = `
        <h3 class="card-title">💬 WhatsApp de Soporte</h3>
        <label>Número con código de país (ej: 584126985783)</label>
        <input type="tel" id="modOwnerWa" value="${c.ownerWa || ""}" placeholder="584126985783">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('whatsapp')">💾 Guardar WhatsApp</button>
      `;
    } else if (activeRuleTab === "cupos") {
      bodyHtml = `
        <h3 class="card-title">📊 Reglas de Cupos y Progreso</h3>
        <label>Máximo de solicitudes diarias por cliente</label>
        <input type="number" min="1" id="modDailyLimit" value="${c.dailyLimit ?? 3}">
        <label>Préstamos pagados para subir de nivel</label>
        <input type="number" min="1" id="modLoansPerLevel" value="${c.loansPerLevel ?? 5}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('cupos')">💾 Guardar Cupos</button>
      `;
    } else if (activeRuleTab === "capital") {
      bodyHtml = `
        <h3 class="card-title">💰 Capital Base</h3>
        <label>Capital inicial disponible ($ USD)</label>
        <input type="number" step="0.01" id="modCapital" value="${c.initialCapital ?? 50}">
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('capital')">💾 Guardar Capital</button>
      `;
    } else if (activeRuleTab === "terminos") {
      bodyHtml = `
        <h3 class="card-title">📜 Términos y Condiciones</h3>
        <label>Texto visible para los clientes al registrarse o pedir crédito</label>
        <textarea id="modTermsText" rows="5" style="width:100%;border-radius:10px;border:1px solid #CBD5E1;padding:10px;font-size:13px;">${c.termsText || "Al solicitar un crédito en CrediCupo Express aceptas pagar tus cuotas puntualmente en las fechas acordadas."}</textarea>
        <button type="button" class="btn btn-primary" onclick="saveModularRuleSection('terminos')">💾 Guardar Términos y Condiciones</button>
      `;
    }

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
        ${gridBtnsHtml}
      </div>
      <div style="border-top:1px solid #E2E8F0;padding-top:12px;">
        ${bodyHtml}
      </div>
    `;
  }

  window.testTgNotif = async () => {
    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    playChime();
    const title = "Has recibido un pago de prueba 💸✅";
    const body = "¡Qué bien! Así avisará CrediCupo Express a ti y a tus clientes.";
    await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
    if (window.CC) window.CC.showToast("🔔 Alerta enviada");
  };

  // ------------------------------------------------------------
  // E. MODAL PARA QUE EL DUEÑO SUBA CAPTURE Y COPIE DATOS AL APROBAR
  // ------------------------------------------------------------
  if (!document.getElementById("ownerDisburseModal")) {
    const modal = document.createElement("div");
    modal.id = "ownerDisburseModal";
    modal.className = "modal-bg hidden";
    modal.onclick = () => modal.classList.add("hidden");
    modal.innerHTML = `
      <div class="modal" onclick="event.stopPropagation()">
        <h3 class="card-title">💸 Aprobar y Subir Capture de Pago</h3>
        <div id="ownerDisbSummary" style="background:#F4F8FF;border:1px solid #C6DAFC;border-radius:10px;padding:10px;font-size:12px;margin-bottom:8px;"></div>

        <label>Referencia de tu transferencia</label>
        <input type="text" id="ownerDisbRef" placeholder="Ej: 458912 o Hash">

        <label>Sube capture del pago realizado al cliente</label>
        <input type="file" id="ownerDisbFile" accept="image/*">
        <img id="ownerDisbPreview" class="preview-img hidden">

        <label>Escribe tu Código Maestro de Dueño para confirmar</label>
        <input type="password" id="ownerDisbPin" inputmode="numeric" placeholder="****">

        <button type="button" class="btn btn-primary" id="btnConfirmDisb">Confirmar Desembolso y Activar</button>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('ownerDisburseModal').classList.add('hidden')">Cancelar</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("ownerDisbFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxW = 720;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          ownerProofDataUrl = canvas.toDataURL("image/jpeg", 0.68);
          const prev = document.getElementById("ownerDisbPreview");
          prev.src = ownerProofDataUrl;
          prev.classList.remove("hidden");
          if (window.CC) window.CC.showToast("📸 Capture de pago listo");
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("btnConfirmDisb").addEventListener("click", async () => {
      if (!window.CC || !currentApproveLoanId) return;
      const { db, state, showToast } = window.CC;

      const pin = document.getElementById("ownerDisbPin").value.trim();
      if (pin !== String(state.cfg.adminPin)) {
        return showToast("⛔ Código Maestro incorrecto");
      }

      const ref = document.getElementById("ownerDisbRef").value.trim();
      if (!ownerProofDataUrl) {
        return showToast("Debes subir el capture del pago al cliente");
      }

      const l = state.loans[currentApproveLoanId];
      if (!l) return;

      const quotas = Number(l.quotas) || 2;
      const stepDays = String(l.freq || "").toLowerCase() === "quincenal" ? 15 : 7;
      const qAmt = Number((Number(l.totalDue) / quotas).toFixed(2));
      const now = Date.now();
      const schedule = [];
      for (let i = 1; i <= quotas; i++) {
        schedule.push({
          num: i,
          amount: qAmt,
          dueDate: now + (i * stepDays * 86400000),
          status: "pendiente"
        });
      }

      state.expandedLoans[currentApproveLoanId] = true;
      await updateDoc(doc(db, "loans", currentApproveLoanId), {
        quotas,
        freq: stepDays === 15 ? "quincenal" : "semanal",
        stepDays,
        status: "activo",
        approvedAt: now,
        schedule,
        disburseProof: ownerProofDataUrl,
        disburseRef: ref || "Sin ref."
      });

      await window.sendClientTelegramAlert(
        l.cedula,
        `¡Tu préstamo fue aprobado! 💸✅`,
        `¡Qué bien, ${l.nombre}! Transferimos $${Number(l.amount).toFixed(2)} USD a tu cuenta (Ref: ${ref || "Enviado"}). Entra a CrediCupo Express para ver tu comprobante.`
      );

      document.getElementById("ownerDisburseModal").classList.add("hidden");
      showToast("✅ Préstamo activado y cliente notificado");
    });
  }

  function buildCopyRow(label, value) {
    if (!value) return "";
    const safeVal = String(value).replace(/'/g, "\\'");
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 0;border-bottom:1px dashed #E2E8F0;">
        <span style="font-size:12px;color:#172B4D;word-break:break-all;"><strong>${label}:</strong> ${value}</span>
        <button type="button" onclick="ccCopyText('${safeVal}','${label}')"
          style="background:#E6FCFF;color:#006644;border:1px solid #B3F5FF;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
          📋 Copiar
        </button>
      </div>
    `;
  }

  window.askApproveLoan = (id) => {
    if (!window.CC) return;
    const { state } = window.CC;
    const l = state.loans[id];
    if (!l) return;

    currentApproveLoanId = id;
    ownerProofDataUrl = "";
    const rate = Number(state.cfg.rate) || 1;
    const bs = (Number(l.amount) * rate).toFixed(2);
    const fullClientCopy = `${l.payInfo} | Monto Bs. ${bs}`.replace(/'/g, "\\'");

    document.getElementById("ownerDisbSummary").innerHTML = `
      <div style="margin-bottom:6px;">Cliente: <strong>${l.nombre}</strong> (V-${l.cedula})</div>
      <div style="font-size:12px;background:#fff;padding:8px;border-radius:8px;border:1px solid #DCE5F2;margin-bottom:8px;">
        <strong>${l.payInfo}</strong><br>
        Monto a transferir: <strong>Bs. ${bs}</strong> ($${Number(l.amount).toFixed(2)} USD)
      </div>
      <div class="grid-2">
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:0;" onclick="ccCopyText('${fullClientCopy}','Datos cliente')">
          📋 Copiar Datos
        </button>
        <button type="button" class="btn btn-sm btn-secondary" style="margin-top:0;" onclick="ccCopyText('${bs}','Monto Bs.')">
          📋 Copiar Bs. ${bs}
        </button>
      </div>
    `;
    document.getElementById("ownerDisbRef").value = "";
    document.getElementById("ownerDisbFile").value = "";
    document.getElementById("ownerDisbPin").value = "";
    const prev = document.getElementById("ownerDisbPreview");
    prev.src = "";
    prev.classList.add("hidden");

    document.getElementById("ownerDisburseModal").classList.remove("hidden");
  };

  // ------------------------------------------------------------
  // F. NOTIFICACIONES, RECHAZO DE CUOTA Y PRÓRROGAS
  // ------------------------------------------------------------
  const origRequestLoan = window.requestLoan;
  if (origRequestLoan && !origRequestLoan._notifWrapped) {
    const wrappedReq = async () => {
      await origRequestLoan();
      if (!window.CC) return;
      const { state } = window.CC;
      const u = state.users[state.currentUserCedula];
      if (!u) return;
      const rule = window.CC.getLevelRule(u.level);
      const sel = document.getElementById("reqQuotaSelect");
      const q = sel ? sel.value : rule.quotas;
      const title = `Nueva solicitud de préstamo 💸✅`;
      const body = `${u.nombre} (V-${u.cedula}) pidió $${rule.amount.toFixed(2)} USD en ${q} cuota(s).`;
      await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
      activeClientTab = "paga_cuota";
      applyClientMenuVisibility(true);
    };
    wrappedReq._notifWrapped = true;
    window.requestLoan = wrappedReq;
  }

  const origSubmitPay = window.submitInstallmentPayment;
  if (origSubmitPay && !origSubmitPay._notifWrapped) {
    const wrappedPay = async (loanId, instNum) => {
      const refVal = (document.getElementById("payRefInput")?.value || "").trim();
      await origSubmitPay(loanId, instNum);
      if (!window.CC || !refVal) return;
      const { state } = window.CC;
      const l = state.loans[loanId];
      if (!l) return;
      const title = `¡Pago de cuota recibido! 💰✅`;
      const body = `${l.nombre} reportó la Cuota #${instNum} • Ref: ${refVal}`;
      await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
    };
    wrappedPay._notifWrapped = true;
    window.submitInstallmentPayment = wrappedPay;
  }

  const origExecPin = window.executePendingPinAction;
  if (origExecPin && !origExecPin._clientNotifWrapped) {
    const wrappedExec = async () => {
      const loansBefore = JSON.parse(JSON.stringify(window.CC?.state?.loans || {}));
      await origExecPin();
      if (!window.CC) return;
      const loansAfter = window.CC.state.loans || {};

      Object.keys(loansAfter).forEach(async (id) => {
        const before = loansBefore[id];
        const after = loansAfter[id];
        if (!before || !after) return;

        if (before.status !== "pagado" && after.status === "pagado") {
          await window.sendClientTelegramAlert(
            after.cedula,
            `Has completado tus pagos 🥳✅`,
            `¡Qué bien, ${after.nombre}! Registramos el pago total de tu préstamo.`
          );
        } else if (before.status !== "rechazado" && after.status === "rechazado") {
          await window.sendClientTelegramAlert(
            after.cedula,
            `Solicitud no aprobada ⚠️`,
            `Hola ${after.nombre}, tu solicitud de préstamo fue rechazada o devuelta.`
          );
        } else if (Array.isArray(after.schedule) && Array.isArray(before.schedule)) {
          after.schedule.forEach(async (qAfter, idx) => {
            const qBefore = before.schedule[idx];
            if (qBefore && qBefore.status !== "pagada" && qAfter.status === "pagada") {
              await window.sendClientTelegramAlert(
                after.cedula,
                `¡Cuota #${qAfter.num} aprobada! 🎉✅`,
                `¡Qué bien, ${after.nombre}! Confirmamos el pago de tu Cuota #${qAfter.num} ($${Number(qAfter.amount).toFixed(2)} USD).`
              );
            }
          });
        }
      });
    };
    wrappedExec._clientNotifWrapped = true;
    window.executePendingPinAction = wrappedExec;
  }

  window.rejectQuotaPayment = async (loanId, instNum) => {
    if (!window.CC || !window.CC.state) return;
    const { db, state, showToast } = window.CC;

    const pin = prompt("Escribe tu Código Maestro de Dueño para rechazar este pago:");
    if (pin !== String(state.cfg.adminPin)) {
      return showToast("⛔ Código Maestro incorrecto");
    }

    const motivo = prompt("Motivo del rechazo:", "Seleccionaste la cuota equivocada. Vuelve a subir el capture en la cuota correcta.");
    if (motivo === null) return;

    const l = state.loans[loanId];
    if (!l || !Array.isArray(l.schedule)) return;

    const sched = l.schedule.map(q => {
      if (Number(q.num) !== Number(instNum)) return q;
      const limpio = { ...q, status: "pendiente" };
      delete limpio.payRef;
      delete limpio.payProof;
      delete limpio.paidAt;
      delete limpio.reportedAt;
      return limpio;
    });

    await updateDoc(doc(db, "loans", loanId), {
      status: "activo",
      schedule: sched
    });

    await window.sendClientTelegramAlert(
      l.cedula,
      `Pago de Cuota #${instNum} rechazado ⚠️`,
      `Hola ${l.nombre}, rechazamos el reporte de tu Cuota #${instNum} (${motivo}). Entra a CrediCupo Express y vuelve a subir el capture en la cuota correcta.`
    );

    showToast(`❌ Pago de Cuota #${instNum} rechazado y devuelto a pendiente`);
  };

  window.updateExtensionPreview = () => {
    if (!window.CC) return;
    const { state } = window.CC;
    const days = Number(document.getElementById("extDaysSelect")?.value || 1);
    const pctPerDay = Number(state.cfg.extDailyPct ?? 4);
    const baseAmt = Number(document.getElementById("extBaseAmtHidden")?.value || 0);
    const extraPct = days * pctPerDay;
    const newAmt = Number((baseAmt * (1 + extraPct / 100)).toFixed(2));
    const rate = Number(state.cfg.rate) || 1;
    const newBs = (newAmt * rate).toFixed(2);
    const prevBox = document.getElementById("extPreviewText");
    if (prevBox) {
      prevBox.innerHTML = `Recargo: <strong>+${extraPct}%</strong> (${pctPerDay}% × ${days} día${days > 1 ? "s" : ""})<br>Nuevo monto de la cuota: <strong>$${newAmt.toFixed(2)} USD (Bs. ${newBs})</strong>`;
    }
  };

  window.requestQuotaExtension = async (loanId, instNum) => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const l = state.loans[loanId];
    if (!l) return;

    const days = Number(document.getElementById("extDaysSelect")?.value || 1);
    const pctPerDay = Number(state.cfg.extDailyPct ?? 4);
    const sched = [...(l.schedule || [])];
    const idx = sched.findIndex(q => q.num === instNum);
    if (idx === -1) return;

    const baseAmt = Number(sched[idx].amount);
    const newAmt = Number((baseAmt * (1 + (days * pctPerDay) / 100)).toFixed(2));

    sched[idx] = {
      ...sched[idx],
      extStatus: "pendiente",
      extDays: days,
      extPctPerDay: pctPerDay,
      extOldAmt: baseAmt,
      extNewAmt: newAmt,
      extRequestedAt: Date.now()
    };

    await updateDoc(doc(db, "loans", loanId), { schedule: sched });

    const title = `Solicitud de Prórroga (${days} día${days > 1 ? "s" : ""}) ⏳`;
    const body = `${l.nombre} (V-${l.cedula}) pide ${days} día(s) para Cuota #${instNum}. Sube de $${baseAmt.toFixed(2)} a $${newAmt.toFixed(2)} USD.`;
    await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
    showToast("✅ Solicitud de prórroga enviada al dueño");
  };

  window.decideQuotaExtension = async (loanId, instNum, approve) => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const pin = prompt("Escribe tu Código Maestro de Dueño para confirmar:");
    if (pin !== String(state.cfg.adminPin)) {
      return showToast("⛔ Código Maestro incorrecto");
    }

    const l = state.loans[loanId];
    if (!l) return;
    const sched = [...(l.schedule || [])];
    const idx = sched.findIndex(q => q.num === instNum);
    if (idx === -1) return;

    const q = sched[idx];
    const days = Number(q.extDays) || 1;
    const newAmt = Number(q.extNewAmt) || Number(q.amount);

    if (approve) {
      const baseDue = Number(q.dueDate) || Date.now();
      const newDue = baseDue + (days * 86400000);
      sched[idx] = {
        ...q,
        amount: newAmt,
        dueDate: newDue,
        extStatus: "aprobada",
        extApprovedAt: Date.now()
      };
      const newTotalDue = Number(sched.reduce((acc, item) => acc + Number(item.amount), 0).toFixed(2));
      await updateDoc(doc(db, "loans", loanId), { schedule: sched, totalDue: newTotalDue });

      const newDateStr = new Date(newDue).toLocaleDateString("es-VE");
      await window.sendClientTelegramAlert(
        l.cedula,
        `¡Prórroga aprobada! ⏳✅`,
        `Hola ${l.nombre}, te aprobamos ${days} día(s) extra para tu Cuota #${instNum}. Nueva fecha: ${newDateStr} • Nuevo monto: $${newAmt.toFixed(2)} USD.`
      );
      showToast(`✅ Prórroga de ${days} día(s) aprobada`);
    } else {
      sched[idx] = { ...q, extStatus: "rechazada" };
      await updateDoc(doc(db, "loans", loanId), { schedule: sched });
      await window.sendClientTelegramAlert(
        l.cedula,
        `Solicitud de prórroga rechazada ⚠️`,
        `Hola ${l.nombre}, tu solicitud de prórroga para la Cuota #${instNum} no fue aprobada.`
      );
      showToast("❌ Prórroga rechazada");
    }
  };

  // ------------------------------------------------------------
  // G. EDICIÓN DE DATOS / CUENTA DEL CLIENTE SOLO CON PERMISO DEL DUEÑO
  // ------------------------------------------------------------
  window.requestProfileEditPermission = async () => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u) return;

    const note = (document.getElementById("cliEditReqReason")?.value || "").trim();
    if (!note) return showToast("Escribe qué dato o cuenta necesitas corregir");

    await updateDoc(doc(db, "users", u.cedula), {
      editRequestNote: note,
      editRequestedAt: Date.now()
    });

    const title = `Permiso para editar datos 🔐`;
    const body = `${u.nombre} (V-${u.cedula}) solicita permiso para editar: "${note}".`;
    await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
    showToast("✅ Solicitud enviada al dueño");
  };

  window.grantClientEditPermission = async (cedula, allow) => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const u = state.users[cedula];
    if (!u) return;

    await updateDoc(doc(db, "users", cedula), {
      canEditProfile: !!allow,
      editRequestNote: allow ? u.editRequestNote : ""
    });

    if (allow) {
      await window.sendClientTelegramAlert(
        cedula,
        `¡Permiso de edición habilitado! 🔓✅`,
        `Hola ${u.nombre}, el administrador autorizó que corrijas tus datos o cuenta de cobro en CrediCupo Express.`
      );
      showToast(`🔓 Edición habilitada para ${u.nombre}`);
    } else {
      showToast(`🔒 Edición bloqueada para ${u.nombre}`);
    }
  };

  function injectClientPayEditor() {
    if (!window.CC || !window.CC.state) return;
    const { state } = window.CC;
    const viewClient = document.getElementById("viewClient");
    if (!viewClient || viewClient.classList.contains("hidden")) return;

    const u = state.users[state.currentUserCedula];
    if (!u) return;

    let card = document.getElementById("cliEditPayMethodCard");
    if (card && card.contains(document.activeElement)) return;

    if (!card) {
      card = document.createElement("div");
      card.id = "cliEditPayMethodCard";
      card.className = "card";
      const histCard = document.getElementById("cliHistoryList")?.closest(".card");
      if (histCard) viewClient.insertBefore(card, histCard);
      else viewClient.appendChild(card);
    }

    const sigState = `${u.cedula}|${u.nombre}|${u.phone}|${u.payInfo}|${u.canEditProfile ? 1 : 0}|${u.editRequestNote || ""}`;
    if (card.dataset.renderSig === sigState) return;
    card.dataset.renderSig = sigState;

    if (u.canEditProfile) {
      card.innerHTML = `
        <div class="card-title" style="margin-bottom:6px;">
          <span>🔓 Edición Autorizada por el Dueño</span>
          <span class="badge b-ok">HABILITADO</span>
        </div>
        <div class="alert alert-info" style="font-size:12px;">
          Corrige tus datos o cuenta de cobro. Al guardar, el candado volverá a cerrarse por seguridad.
        </div>

        <label style="margin-top:4px;">Nombre y Apellido</label>
        <input type="text" id="updFullName" value="${u.nombre}">

        <label>Teléfono WhatsApp / Telegram</label>
        <input type="tel" id="updUserPhone" value="${u.phone}">

        <label>Método de cobro</label>
        <select id="updPayType" onchange="toggleUpdPayType()">
          <option value="pm">Pago Móvil (Bs. a tasa BCV)</option>
          <option value="bvc_full">Banco Venezolano de Crédito (0104) • PM y/o Correo</option>
          <option value="ubii">UBII PAGO • Correo / Teléfono</option>
          <option value="binance">Binance Pay (USDT)</option>
        </select>

        <div id="updPmFields">
          <label>Banco</label>
          <select id="updBank">
            <option value="Venezolano de Crédito (0104)">Banco Venezolano de Crédito (0104)</option>
            <option value="BDV (0102)">Banco de Venezuela (0102)</option>
            <option value="Banesco (0134)">Banesco (0134)</option>
            <option value="Mercantil (0105)">Mercantil (0105)</option>
            <option value="Provincial (0108)">Provincial (0108)</option>
            <option value="BNC (0191)">BNC (0191)</option>
            <option value="Bancamiga (0172)">Bancamiga (0172)</option>
            <option value="Banplus (0174)">Banplus (0174)</option>
          </select>
          <div class="grid-2">
            <div><label>Teléfono PM</label><input type="tel" id="updPmPhone" placeholder="04141234567"></div>
            <div><label>Cédula</label><input type="tel" id="updPmCed" value="${u.cedula}"></div>
          </div>
        </div>

        <div id="updBvcFields" class="hidden">
          <label>Teléfono Pago Móvil BVC (opcional)</label>
          <input type="tel" id="updBvcPhone" placeholder="04141234567">
          <label>Correo registrado en BVC (opcional)</label>
          <input type="email" id="updBvcMail" placeholder="tucorreo@gmail.com">
        </div>

        <div id="updUbiiFields" class="hidden">
          <label>Correo electrónico UBII PAGO</label>
          <input type="email" id="updUbiiMail" placeholder="tucorreo@gmail.com">
          <label>Teléfono UBII PAGO (opcional)</label>
          <input type="tel" id="updUbiiPhone" placeholder="04141234567">
        </div>

        <div id="updBinFields" class="hidden">
          <label>Correo o Binance Pay ID</label>
          <input type="text" id="updBinId" placeholder="tucorreo@gmail.com o ID">
        </div>

        <button type="button" class="btn btn-primary" onclick="saveClientNewPayMethod()">💾 Guardar Cambios y Cerrar Candado</button>
      `;
    } else {
      card.innerHTML = `
        <div class="card-title" style="margin-bottom:6px;">
          <span>💳 Tus Datos y Cuenta de Cobro</span>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('cliReqEditBox').classList.toggle('hidden')">
            🔒 Pedir Editar
          </button>
        </div>
        <div style="font-size:12px;color:var(--text);background:#FAFBFC;padding:9px 10px;border-radius:9px;border:1px solid var(--border);">
          <div><strong>Titular:</strong> ${u.nombre} • V-${u.cedula}</div>
          <div><strong>Tel:</strong> ${u.phone}</div>
          <div style="margin-top:3px;"><strong>Cuenta:</strong> ${u.payInfo}</div>
        </div>
        ${u.editRequestNote ? `
          <div class="alert alert-warn" style="margin-top:8px;margin-bottom:0;font-size:12px;">
            ⏳ Solicitud enviada: <em>"${u.editRequestNote}"</em>. Esperando autorización del dueño.
          </div>
        ` : ""}
        <div id="cliReqEditBox" class="hidden" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;">
          <label style="margin-top:0;">¿Qué dato o banco necesitas corregir?</label>
          <input type="text" id="cliEditReqReason" placeholder="Ej: Me equivoqué en el banco / número de teléfono">
          <button type="button" class="btn btn-primary" onclick="requestProfileEditPermission()">Solicitar Permiso al Dueño</button>
        </div>
      `;
    }
  }

  window.toggleUpdPayType = () => {
    const t = document.getElementById("updPayType").value;
    document.getElementById("updPmFields").classList.toggle("hidden", t !== "pm");
    document.getElementById("updBvcFields").classList.toggle("hidden", t !== "bvc_full");
    document.getElementById("updUbiiFields").classList.toggle("hidden", t !== "ubii");
    document.getElementById("updBinFields").classList.toggle("hidden", t !== "binance");
  };

  window.saveClientNewPayMethod = async () => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u || !u.canEditProfile) return showToast("⛔ No tienes permiso activo para editar");

    const newName = (document.getElementById("updFullName")?.value || u.nombre).trim();
    const newPhone = (document.getElementById("updUserPhone")?.value || u.phone).trim();
    const t = document.getElementById("updPayType").value;
    let newPayInfo = "";

    if (t === "pm") {
      const bank = document.getElementById("updBank").value;
      const ph = document.getElementById("updPmPhone").value.trim();
      const ced = document.getElementById("updPmCed").value.replace(/\D/g, "") || u.cedula;
      if (!ph) return showToast("Escribe tu teléfono Pago Móvil");
      newPayInfo = `${bank} • ${ph} • V-${ced}`;
    } else if (t === "bvc_full") {
      const ph = document.getElementById("updBvcPhone").value.trim();
      const mail = document.getElementById("updBvcMail").value.trim();
      if (!ph && !mail) return showToast("Escribe teléfono o correo de BVC");
      const parts = ["BVC (0104)"];
      if (ph) parts.push(`PM: ${ph}`);
      parts.push(`V-${u.cedula}`);
      if (mail) parts.push(`Correo: ${mail}`);
      newPayInfo = parts.join(" • ");
    } else if (t === "ubii") {
      const mail = document.getElementById("updUbiiMail").value.trim();
      const ph = document.getElementById("updUbiiPhone").value.trim();
      if (!mail && !ph) return showToast("Escribe correo o teléfono de UBII PAGO");
      const parts = ["UBII PAGO"];
      if (mail) parts.push(`Correo: ${mail}`);
      if (ph) parts.push(`Tel: ${ph}`);
      parts.push(`V-${u.cedula}`);
      newPayInfo = parts.join(" • ");
    } else {
      const bin = document.getElementById("updBinId").value.trim();
      if (!bin) return showToast("Escribe tu correo o ID de Binance");
      newPayInfo = `Binance Pay: ${bin}`;
    }

    await setDoc(doc(db, "users", u.cedula), {
      ...u,
      nombre: newName || u.nombre,
      phone: newPhone || u.phone,
      method: t,
      payInfo: newPayInfo,
      canEditProfile: false,
      editRequestNote: ""
    });
    showToast("✅ Datos actualizados y candado cerrado");
  };

  // ------------------------------------------------------------
  // H. CRÉDITO ADICIONAL PARALELO (MÁX. 1 EXTRA + INTERÉS REAL)
  // ------------------------------------------------------------
  function getAvailableLevelsUpTo(maxLevel) {
    const result = [];
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      const rule = getRealLevelData(lvl);
      if (rule && rule.amount > 0) result.push(rule);
    }
    return result;
  }

  window.updateExtraLoanCalc = () => {
    if (!window.CC || !window.CC.state) return;
    const { state } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u) return;

    const lvlSel = document.getElementById("extraLoanLevelSel");
    const qSel = document.getElementById("extraLoanQuotaSel");
    const prevBox = document.getElementById("extraLoanPreview");
    if (!lvlSel || !qSel || !prevBox) return;

    const chosenLvl = Number(lvlSel.value) || 1;
    const rule = getRealLevelData(chosenLvl);
    if (!rule) return;

    if (qSel.dataset.forLevel !== String(chosenLvl)) {
      qSel.dataset.forLevel = String(chosenLvl);
      qSel.innerHTML = "";
      for (let q = 1; q <= rule.quotas; q++) {
        const opt = document.createElement("option");
        opt.value = String(q);
        opt.textContent = `${q} cuota${q > 1 ? "s" : ""} (${rule.freq})`;
        if (q === rule.quotas) opt.selected = true;
        qSel.appendChild(opt);
      }
    }

    const quotas = Number(qSel.value) || rule.quotas;
    const totalDue = Number((rule.amount * (1 + rule.interest / 100)).toFixed(2));
    const perQuota = Number((totalDue / quotas).toFixed(2));
    const rate = Number(state.cfg.rate) || 1;
    const bsAmt = (rule.amount * rate).toFixed(2);

    prevBox.innerHTML = `
      Recibes: <strong>$${rule.amount.toFixed(2)} USD (Bs. ${bsAmt})</strong><br>
      Total a pagar (<strong>${rule.interest}% interés</strong>): <strong>$${totalDue.toFixed(2)} USD</strong> en <strong>${quotas} cuota(s) de $${perQuota.toFixed(2)}</strong>
    `;
  };

  window.submitExtraParallelLoan = async () => {
    if (!window.CC || !window.CC.state) return;
    const { db, state, showToast } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u) return;
    if (u.blocked) return showToast("⛔ Tu cuenta está bloqueada");

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === u.cedula);
    const activeCount = myLoans.filter(l => ["activo", "pagando"].includes(l.status)).length;
    if (activeCount >= 2) {
      return showToast("⛔ Ya tienes tu crédito principal y 1 adicional activo");
    }
    if (myLoans.some(l => l.status === "pendiente")) {
      return showToast("⏳ Ya tienes una solicitud pendiente por aprobar");
    }

    const lvlSel = document.getElementById("extraLoanLevelSel");
    const qSel = document.getElementById("extraLoanQuotaSel");
    const chosenLvl = Number(lvlSel?.value || 1);
    const maxLvl = Number(u.level) || 1;
    if (chosenLvl < 1 || chosenLvl > maxLvl) {
      return showToast("Nivel no permitido para tu cuenta");
    }

    const rule = getRealLevelData(chosenLvl);
    if (!rule) return;

    const quotas = Math.min(rule.quotas, Math.max(1, Number(qSel?.value || rule.quotas)));
    const totalDue = Number((rule.amount * (1 + rule.interest / 100)).toFixed(2));
    const quotaAmount = Number((totalDue / quotas).toFixed(2));
    const loanId = "LN_" + Date.now();

    await setDoc(doc(db, "loans", loanId), {
      id: loanId,
      cedula: u.cedula,
      nombre: u.nombre,
      phone: u.phone,
      payInfo: u.payInfo,
      level: chosenLvl,
      levelName: rule.name,
      amount: rule.amount,
      interest: rule.interest,
      totalDue,
      quotas,
      quotaAmount,
      freq: rule.freq,
      isAdditional: true,
      status: "pendiente",
      createdAt: Date.now()
    });

    const title = `Crédito Adicional Solicitado ➕💸`;
    const body = `${u.nombre} (V-${u.cedula}) pidió crédito adicional Nivel ${chosenLvl} (${rule.name}) por $${rule.amount.toFixed(2)} USD (+${rule.interest}% = $${totalDue.toFixed(2)} USD) en ${quotas} cuota(s).`;
    await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);

    activeClientTab = "paga_cuota";
    applyClientMenuVisibility(true);
    showToast(`✅ Solicitud enviada (+${rule.interest}% interés)`);
  };

  window._selectClientLoan = (id) => {
    selectedActiveLoanId = id;
    if (window.CC && window.CC.refreshUI) window.CC.refreshUI();
  };

  // ------------------------------------------------------------
  // I. GANANCIA EN VIVO (PINTADA DIRECTO EN CADA REFRESHUI)
  // ------------------------------------------------------------
  function calcularGananciaTotalReal() {
    if (!window.CC || !window.CC.state) return 0;
    const loans = Object.values(window.CC.state.loans || {});
    let ganancia = 0;

    loans.forEach(l => {
      if (!["activo", "pagando", "pagado"].includes(l.status)) return;
      const prestado = Number(l.amount) || 0;
      const totalPagar = Number(l.totalDue) || prestado;
      const gananciaPrestamo = Math.max(0, totalPagar - prestado);

      if (l.status === "pagado") {
        ganancia += gananciaPrestamo;
      } else if (Array.isArray(l.schedule) && totalPagar > 0) {
        const cobrado = l.schedule
          .filter(q => q.status === "pagada")
          .reduce((acc, q) => acc + (Number(q.amount) || 0), 0);
        ganancia += (cobrado / totalPagar) * gananciaPrestamo;
      }
    });

    return ganancia;
  }

  function pintarGananciaEnPantalla() {
    if (!window.CC || !window.CC.state || !window.CC.state.isAdmin) return;
    const totalGanancia = calcularGananciaTotalReal();
    const textoNuevo = `$${totalGanancia.toFixed(2)}`;

    const strip = document.querySelector("#viewAdmin .summary-strip");
    if (!strip) return;

    Array.from(strip.children).forEach(box => {
      if ((box.textContent || "").toLowerCase().includes("ganancia")) {
        const hijos = box.querySelectorAll("*");
        let actualizado = false;
        hijos.forEach(el => {
          if (el.children.length === 0 && (el.textContent || "").includes("$")) {
            if (el.textContent.trim() !== textoNuevo) {
              el.textContent = textoNuevo;
            }
            actualizado = true;
          }
        });
        if (!actualizado) {
          box.innerHTML = `<div style="font-size:11px;color:var(--muted);">Ganancia</div><div style="font-size:18px;font-weight:800;color:#00875A;">${textoNuevo}</div>`;
        }
      }
    });
  }

  // ------------------------------------------------------------
  // J. CUADRO LIMPIO DE PAGO + PRÓRROGAS + SINCRONIZACIÓN GENERAL
  // ------------------------------------------------------------
  function renderCleanClientPayBox(infoAlert, c) {
    const text = infoAlert.innerText || "";
    const titleMatch = text.match(/Paga tu Cuota[^\n]+/);
    const titleLine = titleMatch ? titleMatch[0] : "Datos para pagar tu cuota:";
    const bsMatch = titleLine.match(/Bs\.\s*([0-9.,]+)/);
    const bsVal = bsMatch ? bsMatch[1] : "";

    const pmRaw = String(c.ownerPm || "").trim();
    const ubiiVal = String(c.ownerUbii || "").trim();

    const pmPhoneMatch = pmRaw.match(/(04\d{2}-?\d{7})/);
    const pmCedMatch = pmRaw.match(/([VE]-?\d{6,9})/i);
    const pmBankMatch = pmRaw.split("•")[0]?.trim() || "BDV (0102)";
    const pmPhoneClean = pmPhoneMatch ? pmPhoneMatch[1].replace(/\D/g, "") : "";
    const pmCedClean = pmCedMatch ? pmCedMatch[1].replace(/\D/g, "") : "";

    const pmCopyAll = (pmPhoneClean && pmCedClean)
      ? `${pmBankMatch} ${pmPhoneClean} ${pmCedClean}`
      : pmRaw;
    const safePmAll = pmCopyAll.replace(/'/g, "\\'");

    infoAlert.style.cssText = "background:#F4F8FF;border:1px solid #C6DAFC;border-radius:12px;padding:12px;color:#172B4D;";
    infoAlert.innerHTML = `
      <div style="font-weight:800;font-size:13px;color:#0747A6;margin-bottom:8px;">${titleLine}</div>

      ${pmRaw ? `
        <div style="background:#FFFFFF;border:1px solid #DCE5F2;border-radius:9px;padding:9px 10px;margin-bottom:8px;">
          <div style="font-size:11px;font-weight:800;color:#00875A;margin-bottom:4px;">🏦 PAGO MÓVIL</div>
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:#172B4D;">${pmRaw}</div>
          <div class="grid-2">
            <button type="button" class="btn btn-sm btn-primary" style="margin-top:0;" onclick="ccCopyText('${safePmAll}','Pago Móvil completo')">
              📋 Copiar Todo
            </button>
            ${bsVal ? `
              <button type="button" class="btn btn-sm btn-secondary" style="margin-top:0;" onclick="ccCopyText('${bsVal}','Monto Bs.')">
                📋 Copiar Bs. ${bsVal}
              </button>
            ` : ""}
          </div>
        </div>
      ` : ""}

      ${ubiiVal ? `
        <div style="background:#FFFFFF;border:1px solid #DCE5F2;border-radius:9px;padding:9px 10px;">
          <div style="font-size:11px;font-weight:800;color:#0052CC;margin-bottom:4px;">📲 UBII PAGO</div>
          ${buildCopyRow("UBII PAGO", ubiiVal)}
        </div>
      ` : ""}
    `;
    infoAlert.dataset.cleanBoxDone = titleLine;
  }

  function injectExtensionWidgetInClient(activeLoan, cfg) {
    if (!activeLoan || !Array.isArray(activeLoan.schedule)) return;
    const nextQ = activeLoan.schedule.find(q => q.status === "pendiente");
    const payForm = document.getElementById("cliPayFormBox");
    if (!nextQ || !payForm || payForm.classList.contains("hidden")) {
      const oldBox = document.getElementById("cliExtensionBox");
      if (oldBox) oldBox.remove();
      return;
    }

    const sig = `${activeLoan.id}-${nextQ.num}-${nextQ.amount}-${nextQ.extStatus || "none"}-${cfg.extDailyPct ?? 4}`;
    let extBox = document.getElementById("cliExtensionBox");
    if (extBox && extBox.dataset.extSig === sig) return;

    if (!extBox) {
      extBox = document.createElement("div");
      extBox.id = "cliExtensionBox";
      extBox.style.cssText = "margin-top:12px;border-top:1px dashed #CBD5E1;padding-top:10px;";
      payForm.appendChild(extBox);
    }
    extBox.dataset.extSig = sig;

    const pctPerDay = Number(cfg.extDailyPct ?? 4);
    if (nextQ.extStatus === "pendiente") {
      extBox.innerHTML = `
        <div class="alert alert-warn" style="margin-bottom:0;font-size:12px;">
          ⏳ <strong>Prórroga en revisión:</strong> Pediste <strong>${nextQ.extDays} día(s)</strong> extra para la Cuota #${nextQ.num} (subiría a <strong>$${Number(nextQ.extNewAmt).toFixed(2)} USD</strong>). Esperando aprobación del dueño.
        </div>
      `;
    } else if (nextQ.extStatus === "aprobada") {
      extBox.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:0;font-size:12px;">
          ✅ <strong>Prórroga aplicada (+${nextQ.extDays} día${nextQ.extDays > 1 ? "s" : ""}):</strong> Tu nueva fecha de pago ya está actualizada.
        </div>
      `;
    } else {
      extBox.innerHTML = `
        <button type="button" class="btn btn-sm btn-secondary" style="width:100%;" onclick="document.getElementById('extFormWrap').classList.toggle('hidden');updateExtensionPreview();">
          ⏳ ¿No tienes hoy? Pedir Prórroga (1 a 5 días)
        </button>
        <div id="extFormWrap" class="hidden" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:10px;margin-top:8px;">
          <input type="hidden" id="extBaseAmtHidden" value="${nextQ.amount}">
          <label style="margin-top:0;">¿Cuántos días de prórroga necesitas? (+${pctPerDay}% por día)</label>
          <select id="extDaysSelect" onchange="updateExtensionPreview()">
            <option value="1">1 día (+${pctPerDay}%)</option>
            <option value="2">2 días (+${pctPerDay * 2}%)</option>
            <option value="3">3 días (+${pctPerDay * 3}%)</option>
            <option value="4">4 días (+${pctPerDay * 4}%)</option>
            <option value="5">5 días (+${pctPerDay * 5}%)</option>
          </select>
          <div id="extPreviewText" style="font-size:12px;color:#92400E;margin-top:6px;"></div>
          <button type="button" class="btn btn-sm btn-primary" style="margin-top:8px;width:100%;" onclick="requestQuotaExtension('${activeLoan.id}', ${nextQ.num})">
            Enviar Solicitud de Prórroga
          </button>
        </div>
      `;
      setTimeout(() => window.updateExtensionPreview(), 50);
    }
  }

  async function syncAllExtraFeatures() {
    if (isSyncing) return;
    if (!window.CC || !window.CC.state || !window.CC.state.loadedCfg) return;

    isSyncing = true;
    try {
      const { db, state, showToast } = window.CC;
      const c = state.cfg;

      // Reparar automáticamente la propiedad lvl en niveles si falta
      if (Array.isArray(c.levels) && c.levels.some(item => item && !item.lvl)) {
        const reparados = c.levels.map((item, idx) => ({
          ...item,
          lvl: idx + 1,
          level: idx + 1,
          pct: Number(item.pct ?? item.interest ?? 23),
          interest: Number(item.pct ?? item.interest ?? 23)
        }));
        guardarParcialBlindado({ levels: reparados }).catch(() => {});
      }

      if (typeof window.CC.refreshUI === "function" && !window.CC.refreshUI._gananciaWrapped) {
        const origRefresh = window.CC.refreshUI;
        const wrappedRefresh = function (...args) {
          const res = origRefresh.apply(this, args);
          pintarGananciaEnPantalla();
          renderModularRulesPanel(false);
          applyClientMenuVisibility(false);
          return res;
        };
        wrappedRefresh._gananciaWrapped = true;
        window.CC.refreshUI = wrappedRefresh;
      }

      // Blindaje anti-borrado total (niveles, Pago Móvil, UBII, Telegram, etc.)
      const nivelesIncompletos = !Array.isArray(c.levels) || c.levels.length === 0 || Number(c.levels[0]?.amount || 0) <= 0;
      const datosFaltantes = !c.ownerPm || !c.ownerUbii || !c.tgBotToken || !c.tgOwnerChatId;

      if (!restaurandoCfg && (nivelesIncompletos || datosFaltantes)) {
        restaurandoCfg = true;
        try {
          const snap = await getDoc(doc(db, "credicupo", "backup_config"));
          if (snap.exists()) {
            const bkp = snap.data();
            if (bkp.ownerPm || bkp.ownerUbii || bkp.tgBotToken || (Array.isArray(bkp.levels) && bkp.levels.length > 0)) {
              const { updatedAt, rate, ...restaurado } = bkp;
              if (Array.isArray(restaurado.levels)) {
                restaurado.levels = restaurado.levels.map((item, idx) => ({
                  ...item,
                  lvl: idx + 1,
                  level: idx + 1
                }));
              }
              const cfgFinal = {
                ...c,
                ...restaurado,
                rate: c.rate || bkp.rate
              };
              await setDoc(doc(db, "credicupo", "config"), cfgFinal, { merge: true });
              state.cfg = cfgFinal;
              renderModularRulesPanel(true);
            }
          }
        } catch (e) {} finally {
          setTimeout(() => { restaurandoCfg = false; }, 4000);
        }
      }

      renderModularRulesPanel(false);
      injectClientPayEditor();

      // Capturar Chat ID de Telegram del cliente
      if (state.currentUserCedula && state.users[state.currentUserCedula]) {
        const u = state.users[state.currentUserCedula];
        const currentTgId = getCurrentTelegramUserId();
        if (currentTgId && u.tgChatId !== currentTgId && !u._savingTgId) {
          u._savingTgId = true;
          updateDoc(doc(db, "users", u.cedula), { tgChatId: currentTgId }).catch(() => {});
        }
      }

      // Vista del Cliente
      const viewClient = document.getElementById("viewClient");
      const actBox = document.getElementById("cliActiveLoanBox");

      if (viewClient && !viewClient.classList.contains("hidden") && state.currentUserCedula) {
        const u = state.users[state.currentUserCedula];
        const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === state.currentUserCedula);
        const activeLoans = myLoans
          .filter(l => ["activo", "pagando"].includes(l.status))
          .sort((a, b) => a.createdAt - b.createdAt);
        const hasPending = myLoans.some(l => l.status === "pendiente");

        let switcher = document.getElementById("multiLoanSwitcher");
        if (actBox && activeLoans.length > 1) {
          if (!selectedActiveLoanId || !activeLoans.some(l => l.id === selectedActiveLoanId)) {
            selectedActiveLoanId = activeLoans[0].id;
          }
          if (!switcher) {
            switcher = document.createElement("div");
            switcher.id = "multiLoanSwitcher";
            switcher.style.cssText = "display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;";
            actBox.insertBefore(switcher, actBox.firstChild);
          }
          const swSig = activeLoans.map(l => `${l.id}-${l.id === selectedActiveLoanId ? 1 : 0}`).join("|");
          if (switcher.dataset.sig !== swSig) {
            switcher.dataset.sig = swSig;
            switcher.innerHTML = activeLoans.map((l, i) => `
              <button type="button" class="btn btn-sm ${l.id === selectedActiveLoanId ? "btn-primary" : "btn-secondary"}"
                style="margin-top:0;flex:1;"
                onclick="window._selectClientLoan('${l.id}')">
                Crédito #${i + 1} ($${Number(l.amount).toFixed(2)})
              </button>
            `).join("");
          }
        } else if (switcher) {
          switcher.remove();
        }

        if (actBox) {
          const infoAlert = actBox.querySelector(".alert.alert-info");
          if (infoAlert) {
            const curTitle = (infoAlert.innerText.match(/Paga tu Cuota[^\n]+/) || [""])[0];
            if (infoAlert.dataset.cleanBoxDone !== curTitle) {
              renderCleanClientPayBox(infoAlert, c);
            }
          }

          const activeLoan = activeLoans.find(l => l.id === selectedActiveLoanId) || activeLoans[activeLoans.length - 1];
          injectExtensionWidgetInClient(activeLoan, c);

          if (activeLoan && activeLoan.disburseProof && !document.getElementById("cliDisbProofBtn")) {
            const strip = actBox.querySelector(".summary-strip");
            if (strip) {
              const btnWrap = document.createElement("div");
              btnWrap.id = "cliDisbProofBtn";
              btnWrap.style.cssText = "margin-bottom:10px;";
              btnWrap.innerHTML = `
                <button type="button" class="btn btn-sm btn-secondary" style="width:100%;background:#E3FCEF;color:#006644;border:1px solid #B7EB8F;"
                  onclick="openPhoto('${activeLoan.disburseProof}', 'Comprobante de Desembolso • Ref: ${activeLoan.disburseRef || 'Pagado'}')">
                  🧾 Ver Capture de tu Préstamo Recibido ${activeLoan.disburseRef ? `(Ref: ${activeLoan.disburseRef})` : ''}
                </button>
              `;
              strip.parentNode.insertBefore(btnWrap, strip.nextSibling);
            }
          }
        }

        // Tarjeta de crédito adicional: SOLO cuando activeLoans.length === 1
        let addCard = document.getElementById("cliExtraParallelCard");
        if (u && activeLoans.length === 1 && !u.blocked) {
          if (!addCard) {
            addCard = document.createElement("div");
            addCard.id = "cliExtraParallelCard";
            addCard.className = "card";
            const payCard = document.getElementById("cliEditPayMethodCard");
            const histCard = document.getElementById("cliHistoryList")?.closest(".card");
            const refNode = payCard || histCard;
            if (refNode) viewClient.insertBefore(addCard, refNode);
            else viewClient.appendChild(addCard);
          }

          const cardSig = `${u.cedula}-${u.level}-${hasPending ? 1 : 0}-${activeLoans.length}`;
          if (addCard.dataset.sig !== cardSig) {
            addCard.dataset.sig = cardSig;
            if (hasPending) {
              addCard.innerHTML = `
                <div class="card-title" style="margin-bottom:4px;">
                  <span>➕ Crédito Adicional</span>
                  <span class="badge b-warn">EN REVISIÓN</span>
                </div>
                <div class="alert alert-warn" style="margin-bottom:0;font-size:12px;">
                  ⏳ Ya tienes una solicitud adicional pendiente por aprobación del dueño.
                </div>
              `;
            } else {
              const avail = getAvailableLevelsUpTo(Number(u.level) || 1);
              const optionsHtml = avail.slice().reverse().map(r =>
                `<option value="${r.level}">Nivel ${r.level} • ${r.name} ($${r.amount.toFixed(2)} USD)</option>`
              ).join("");

              addCard.innerHTML = `
                <div class="card-title" style="margin-bottom:6px;">
                  <span>➕ Pedir Otro Crédito Activo</span>
                </div>
                <div style="font-size:12px;color:var(--muted);">
                  Puedes solicitar 1 crédito adicional en tu nivel actual (<strong>Nivel ${u.level}</strong>) o en un nivel inferior.
                </div>
                <div id="extraParallelForm" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;">
                  <label style="margin-top:0;">Elige el nivel del crédito adicional</label>
                  <select id="extraLoanLevelSel" onchange="updateExtraLoanCalc()">
                    ${optionsHtml}
                  </select>
                  <label>Cantidad de cuotas</label>
                  <select id="extraLoanQuotaSel" onchange="updateExtraLoanCalc()"></select>
                  <div id="extraLoanPreview" class="alert alert-info" style="margin-top:8px;margin-bottom:8px;font-size:12px;"></div>
                  <button type="button" class="btn btn-primary" onclick="submitExtraParallelLoan()">
                    Enviar Solicitud de Crédito Adicional
                  </button>
                </div>
              `;
              setTimeout(() => window.updateExtraLoanCalc(), 50);
            }
          }
        } else if (addCard) {
          addCard.remove();
        }

        applyClientMenuVisibility(false);
      }

      pintarGananciaEnPantalla();

      // Vista del Dueño: Préstamos
      const admPane = document.getElementById("admPaneLoans");
      if (admPane && !admPane.classList.contains("hidden")) {
        admPane.querySelectorAll(".item-box").forEach(card => {
          const delBtn = card.querySelector("button[onclick^='askDeleteLoan']");
          if (!delBtn) return;
          const match = delBtn.getAttribute("onclick").match(/askDeleteLoan\('([^']+)'/);
          if (!match) return;
          const loan = state.loans[match[1]];
          if (!loan) return;

          const cuotasEnRevision = (loan.schedule || []).filter(q =>
            q.status !== "pagada" && (q.status === "revision" || q.status === "pagando" || q.payRef || q.payProof)
          );
          cuotasEnRevision.forEach(q => {
            const btnId = `btnRejQ_${loan.id}_${q.num}`;
            if (document.getElementById(btnId)) return;

            const rows = Array.from(card.querySelectorAll("div"));
            const targetRow = rows.find(el =>
              el.children.length > 0 &&
              el.innerText &&
              el.innerText.includes(`C${q.num}/`) &&
              !el.querySelector(`#${btnId}`)
            );

            const rejBtn = document.createElement("button");
            rejBtn.id = btnId;
            rejBtn.type = "button";
            rejBtn.className = "btn btn-sm btn-danger";
            rejBtn.style.cssText = "margin-top:4px;margin-left:4px;padding:4px 8px;font-size:11px;";
            rejBtn.textContent = `❌ Rechazar C${q.num}`;
            rejBtn.onclick = () => window.rejectQuotaPayment(loan.id, q.num);

            if (targetRow) targetRow.appendChild(rejBtn);
            else delBtn.parentNode.insertBefore(rejBtn, delBtn);
          });

          const extQ = (loan.schedule || []).find(q => q.extStatus === "pendiente");
          let extAdminBanner = card.querySelector(".admin-ext-banner");
          if (extQ) {
            const extSig = `${loan.id}-${extQ.num}-${extQ.extDays}-${extQ.extNewAmt}`;
            if (!extAdminBanner || extAdminBanner.dataset.sig !== extSig) {
              if (!extAdminBanner) {
                extAdminBanner = document.createElement("div");
                extAdminBanner.className = "admin-ext-banner";
                extAdminBanner.style.cssText = "background:#FFFBEB;border:1px solid #F59E0B;border-radius:9px;padding:9px;margin:8px 0;font-size:12px;";
                card.appendChild(extAdminBanner);
              }
              extAdminBanner.dataset.sig = extSig;
              extAdminBanner.innerHTML = `
                <div style="font-weight:800;color:#92400E;margin-bottom:4px;">
                  ⏳ Solicitud de Prórroga: Cuota #${extQ.num} (+${extQ.extDays} día${extQ.extDays > 1 ? "s" : ""})
                </div>
                <div style="margin-bottom:6px;">
                  Sube de <strong>$${Number(extQ.extOldAmt).toFixed(2)}</strong> a <strong>$${Number(extQ.extNewAmt).toFixed(2)} USD</strong> (+${extQ.extDays * extQ.extPctPerDay}%)
                </div>
                <div class="grid-2">
                  <button type="button" class="btn btn-sm btn-primary" style="margin-top:0;" onclick="decideQuotaExtension('${loan.id}', ${extQ.num}, true)">✅ Aprobar</button>
                  <button type="button" class="btn btn-sm btn-danger" style="margin-top:0;" onclick="decideQuotaExtension('${loan.id}', ${extQ.num}, false)">❌ Rechazar</button>
                </div>
              `;
            }
          } else if (extAdminBanner) {
            extAdminBanner.remove();
          }

          if (card.dataset.disbChecked) return;
          card.dataset.disbChecked = "1";

          const copyAccBtn = document.createElement("button");
          copyAccBtn.type = "button";
          copyAccBtn.className = "btn btn-sm btn-secondary";
          copyAccBtn.textContent = "📋 Copiar Cuenta";
          copyAccBtn.onclick = () => window.ccCopyText(loan.payInfo, "Cuenta cliente");
          delBtn.parentNode.insertBefore(copyAccBtn, delBtn);

          if (loan.disburseProof) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-sm btn-secondary";
            btn.textContent = "Ver Mi Capture";
            btn.onclick = () => window.openPhoto(loan.disburseProof, `Desembolso a ${loan.nombre} • Ref: ${loan.disburseRef || 'N/A'}`);
            delBtn.parentNode.insertBefore(btn, delBtn);
          }
        });
      }

      // Vista del Dueño: Clientes
      const usersPane = document.getElementById("admPaneUsers");
      if (usersPane && !usersPane.classList.contains("hidden")) {
        usersPane.querySelectorAll(".item-box").forEach(card => {
          const text = card.innerText || "";
          const cedMatch = text.match(/V-(\d{6,9})/);
          if (!cedMatch) return;
          const ced = cedMatch[1];
          const u = state.users[ced];
          if (!u) return;

          const permSig = `${ced}-${u.canEditProfile ? 1 : 0}-${u.editRequestNote || ""}`;
          let permBox = card.querySelector(".admin-edit-perm-box");
          if (permBox && permBox.dataset.sig === permSig) return;
          if (!permBox) {
            permBox = document.createElement("div");
            permBox.className = "admin-edit-perm-box";
            permBox.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px dashed #E2E8F0;";
            card.appendChild(permBox);
          }
          permBox.dataset.sig = permSig;

          if (u.canEditProfile) {
            permBox.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                <span style="font-size:11px;font-weight:700;color:#006644;">🔓 Edición de datos activa</span>
                <button type="button" class="btn btn-sm btn-secondary" style="margin-top:0;" onclick="grantClientEditPermission('${ced}', false)">🔒 Cerrar Candado</button>
              </div>
            `;
          } else {
            permBox.innerHTML = `
              ${u.editRequestNote ? `<div style="font-size:11px;color:#92400E;background:#FFFBEB;padding:5px 8px;border-radius:7px;margin-bottom:6px;">📩 Pide editar: <strong>"${u.editRequestNote}"</strong></div>` : ""}
              <button type="button" class="btn btn-sm ${u.editRequestNote ? "btn-primary" : "btn-secondary"}" style="margin-top:0;width:100%;" onclick="grantClientEditPermission('${ced}', true)">
                🔓 Dar Permiso para Editar Datos / Cuenta
              </button>
            `;
          }
        });
      }

      // Alertas sonoras en vivo
      const loansArr = Object.values(state.loans || {});
      const pendCount = loansArr.filter(l => l.status === "pendiente").length;
      const revCount = loansArr.filter(l => l.status === "pagando").length;
      const extCount = loansArr.filter(l => (l.schedule || []).some(q => q.extStatus === "pendiente")).length;
      const sig = `${pendCount}-${revCount}-${extCount}`;
      if (knownSig !== null && sig !== knownSig && state.isAdmin) {
        playChime();
        showToast(`🔔 ¡Novedad! (${pendCount} préstamos • ${revCount} pagos • ${extCount} prórrogas)`);
      }
      knownSig = sig;

      if (state.currentUserCedula && !state.isAdmin) {
        const myLoans = loansArr.filter(l => l.cedula === state.currentUserCedula);
        const cliSig = myLoans.map(l => `${l.id}:${l.status}:${(l.schedule || []).map(q => `${q.status}-${q.extStatus || ""}`).join(",")}`).join("|");
        if (clientKnownSig !== null && cliSig !== clientKnownSig) {
          playChime();
          showToast("🎉 ¡Tu cuenta fue actualizada! Revisa tu estado.");
        }
        clientKnownSig = cliSig;
      }
    } finally {
      isSyncing = false;
    }
  }

  setInterval(syncAllExtraFeatures, 1200);
})();
