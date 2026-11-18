// ============================================================
// MÓDULO COMPLETO EXTRAS - CREDICUPO EXPRESS
// Incluye:
// 1. Prórroga de 1 a 5 días con % diario editable + aprobación del dueño
// 2. Edición de datos/cuenta del cliente SOLO con permiso del dueño
// 3. Pago Móvil (Copiar Todo), UBII PAGO, Capture de desembolso y Alertas Telegram
// ============================================================
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function iniciarCrediCupoExtras() {
  let ownerProofDataUrl = "";
  let currentApproveLoanId = null;
  let knownSig = null;
  let clientKnownSig = null;

  // ------------------------------------------------------------
  // 0. FUNCIÓN UNIVERSAL PARA COPIAR CON UN TOQUE
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

  // ------------------------------------------------------------
  // A. TIMBRE FUERTE + BANNER DE SISTEMA + ENVÍO TELEGRAM (DUEÑO Y CLIENTE)
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
    } catch (err) {
      console.warn("Error enviando mensaje Telegram:", err);
    }
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
  // B. MÉTODOS DE COBRO DEL CLIENTE EN REGISTRO (BVC, UBII, PM, BINANCE)
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
  // C. MODAL PARA QUE EL DUEÑO SUBA CAPTURE Y COPIE DATOS AL APROBAR
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
  // D. NOTIFICACIONES ESTILO CASHEA PARA DUEÑO Y CLIENTE
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
            `¡Qué bien, ${after.nombre}! Registramos el pago total de tu préstamo. Sigue disfrutando de tus cupos en CrediCupo Express.`
          );
        } else if (before.status !== "rechazado" && after.status === "rechazado") {
          await window.sendClientTelegramAlert(
            after.cedula,
            `Solicitud no aprobada ⚠️`,
            `Hola ${after.nombre}, tu solicitud de préstamo fue rechazada o devuelta. Entra a CrediCupo Express para revisar.`
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

  // ------------------------------------------------------------
  // E. PRÓRROGA DE 1 A 5 DÍAS CON RECARGO DIARIO EDITABLE
  // ------------------------------------------------------------
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
        `Hola ${l.nombre}, tu solicitud de prórroga para la Cuota #${instNum} no fue aprobada. Mantén tu fecha original de pago.`
      );
      showToast("❌ Prórroga rechazada");
    }
  };

  // ------------------------------------------------------------
  // F. CONFIGURACIÓN DEL DUEÑO (UBII PAGO, % PRÓRROGA Y TELEGRAM)
  // ------------------------------------------------------------
  function injectAdminExtraBoxes() {
    const cfgPane = document.querySelector("#admPaneCfg .card");
    if (!cfgPane) return;
    const levelsTitle = cfgPane.querySelector("h3.card-title:nth-of-type(2)");

    if (!document.getElementById("extraBanksAdminBox")) {
      const extraBox = document.createElement("div");
      extraBox.id = "extraBanksAdminBox";
      extraBox.style.cssText = "background:#F0FFF8;border:1px solid #B7EB8F;border-radius:10px;padding:12px;margin-top:12px;";
      extraBox.innerHTML = `
        <strong style="font-size:13px;color:var(--primary);display:block;margin-bottom:6px;">
          📲 UBII PAGO y Regla de Prórroga
        </strong>
        <label style="margin-top:4px;">Correo o Teléfono UBII PAGO</label>
        <input type="text" id="cfgOwnerUbii" placeholder="willy161198@gmail.com">
        <label>Recargo por día de prórroga (% diario, máx. 5 días)</label>
        <input type="number" step="0.5" id="cfgExtDailyPct" placeholder="4">
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:10px;width:100%;" onclick="saveExtraAllCfg()">
          Guardar UBII y % Prórroga
        </button>
      `;
      if (levelsTitle) cfgPane.insertBefore(extraBox, levelsTitle);
      else cfgPane.appendChild(extraBox);
    }

    if (!document.getElementById("tgNotifAdminBox")) {
      const tgBox = document.createElement("div");
      tgBox.id = "tgNotifAdminBox";
      tgBox.style.cssText = "background:#DEEBFF;border:1px solid #B3D4FF;border-radius:10px;padding:12px;margin-top:12px;";
      tgBox.innerHTML = `
        <strong style="font-size:13px;color:#0747A6;display:block;margin-bottom:6px;">
          🔔 Notificaciones Tipo Cashea (Dueño y Clientes)
        </strong>
        <label style="margin-top:4px;">Token de tu Bot (@BotFather)</label>
        <input type="text" id="cfgTgToken" placeholder="9100956059:AAG...">
        <label>Tu Chat ID de Telegram (@userinfobot)</label>
        <input type="tel" id="cfgTgChatId" placeholder="8851780047">
        <div class="grid-2" style="margin-top:8px;">
          <button type="button" class="btn btn-sm btn-primary" onclick="saveExtraAllCfg()">Guardar Alertas</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="testTgNotif()">Probar Alerta</button>
        </div>
      `;
      if (levelsTitle) cfgPane.insertBefore(tgBox, levelsTitle);
      else cfgPane.appendChild(tgBox);
    }
  }

  window.saveExtraAllCfg = async () => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    const ownerUbii = (document.getElementById("cfgOwnerUbii")?.value || "").trim();
    const extDailyPct = Number(document.getElementById("cfgExtDailyPct")?.value || 4);
    const tgBotToken = (document.getElementById("cfgTgToken")?.value || "").trim();
    const tgOwnerChatId = (document.getElementById("cfgTgChatId")?.value || "").trim();

    await setDoc(doc(db, "credicupo", "config"), {
      ...state.cfg,
      ownerBin: "",
      ownerBvcPm: "",
      ownerBvcMail: "",
      ownerUbii,
      extDailyPct,
      tgBotToken,
      tgOwnerChatId
    });
    showToast("✅ Ajustes guardados correctamente");
  };

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

  const origSaveAdmin = window.saveAdminConfig;
  if (origSaveAdmin && !origSaveAdmin._extraWrapped) {
    const wrappedSave = async () => {
      await origSaveAdmin();
      await window.saveExtraAllCfg();
    };
    wrappedSave._extraWrapped = true;
    window.saveAdminConfig = wrappedSave;
  }

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
    const body = `${u.nombre} (V-${u.cedula}) solicita permiso para editar: "${note}". Entra a Clientes para autorizar.`;
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
      // MODO DESBLOQUEADO POR EL DUEÑO
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
      // MODO PROTEGIDO: SOLO PUEDE PEDIR PERMISO AL DUEÑO
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
  // H. DISEÑO LIMPIO + BOTÓN DE PRÓRROGA EN VISTA DE CLIENTE
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

  function injectExtensionWidgetInClient(actBox, activeLoan, cfg) {
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

  function syncAllExtraFeatures() {
    if (!window.CC || !window.CC.state || !window.CC.state.loadedCfg) return;
    const { db, state, showToast } = window.CC;
    const c = state.cfg;

    injectAdminExtraBoxes();
    injectClientPayEditor();

    // Capturar automáticamente el Chat ID de Telegram del cliente
    if (state.currentUserCedula && state.users[state.currentUserCedula]) {
      const u = state.users[state.currentUserCedula];
      const currentTgId = getCurrentTelegramUserId();
      if (currentTgId && u.tgChatId !== currentTgId && !u._savingTgId) {
        u._savingTgId = true;
        updateDoc(doc(db, "users", u.cedula), { tgChatId: currentTgId }).catch(() => {});
      }
    }

    const mapInputs = [
      ["cfgOwnerUbii", c.ownerUbii],
      ["cfgExtDailyPct", c.extDailyPct ?? 4],
      ["cfgTgToken", c.tgBotToken],
      ["cfgTgChatId", c.tgOwnerChatId]
    ];
    mapInputs.forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el && !el.dataset.loaded) {
        el.value = val ?? "";
        el.dataset.loaded = "1";
      }
    });

    // Vista del Cliente
    const actBox = document.getElementById("cliActiveLoanBox");
    if (actBox && !actBox.classList.contains("hidden")) {
      const infoAlert = actBox.querySelector(".alert.alert-info");
      if (infoAlert) {
        const curTitle = (infoAlert.innerText.match(/Paga tu Cuota[^\n]+/) || [""])[0];
        if (infoAlert.dataset.cleanBoxDone !== curTitle) {
          renderCleanClientPayBox(infoAlert, c);
        }
      }

      if (state.currentUserCedula) {
        const myLoans = Object.values(state.loans)
          .filter(l => l.cedula === state.currentUserCedula && ["activo", "pagando"].includes(l.status))
          .sort((a, b) => b.createdAt - a.createdAt);
        const activeLoan = myLoans[0];

        injectExtensionWidgetInClient(actBox, activeLoan, c);

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
    }

    // Vista del Dueño: Préstamos (Prórrogas pendientes + Copiar Cuenta + Ver Capture)
    const admPane = document.getElementById("admPaneLoans");
    if (admPane && !admPane.classList.contains("hidden")) {
      admPane.querySelectorAll(".item-box").forEach(card => {
        const delBtn = card.querySelector("button[onclick^='askDeleteLoan']");
        if (!delBtn) return;
        const match = delBtn.getAttribute("onclick").match(/askDeleteLoan\('([^']+)'/);
        if (!match) return;
        const loan = state.loans[match[1]];
        if (!loan) return;

        // Mostrar banner de prórroga pendiente si el cliente pidió días extra
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

    // Vista del Dueño: Clientes (Botón para autorizar edición de datos/cuenta)
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

    // Alerta sonora en vivo para el dueño
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

    // Alerta sonora en vivo para el cliente
    if (state.currentUserCedula && !state.isAdmin) {
      const myLoans = loansArr.filter(l => l.cedula === state.currentUserCedula);
      const cliSig = myLoans.map(l => `${l.id}:${l.status}:${(l.schedule || []).map(q => `${q.status}-${q.extStatus || ""}`).join(",")}`).join("|");
      if (clientKnownSig !== null && cliSig !== clientKnownSig) {
        playChime();
        showToast("🎉 ¡Tu cuenta fue actualizada! Revisa tu estado.");
      }
      clientKnownSig = cliSig;
    }
  }

  const obs = new MutationObserver(() => syncAllExtraFeatures());
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(syncAllExtraFeatures, 1200);
})();
// ============================================================
// MÓDULO EXTRA 4: CRÉDITO ADICIONAL (MISMO NIVEL O INFERIOR)
// ============================================================
import { doc as docMulti, setDoc as setDocMulti } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function iniciarCreditoAdicional() {
  let selectedActiveLoanId = null;

  function getAvailableLevelsUpTo(maxLevel) {
    if (!window.CC || !window.CC.state) return [];
    const levels = Array.isArray(window.CC.state.cfg?.levels) ? window.CC.state.cfg.levels : [];
    const result = [];
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      const rule = window.CC.getLevelRule ? window.CC.getLevelRule(lvl) : levels[lvl - 1];
      if (rule) {
        result.push({
          level: lvl,
          name: rule.name || `Nivel ${lvl}`,
          amount: Number(rule.amount) || 0,
          interest: Number(rule.interest) || 0,
          quotas: Number(rule.quotas) || 1,
          freq: rule.freq || "semanal"
        });
      }
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
    const avail = getAvailableLevelsUpTo(Number(u.level) || 1);
    const rule = avail.find(r => r.level === chosenLvl) || avail[0];
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
      Total a pagar (${rule.interest}% interés): <strong>$${totalDue.toFixed(2)} USD</strong> en <strong>${quotas} cuota(s) de $${perQuota.toFixed(2)}</strong>
    `;
  };

  window.submitExtraParallelLoan = async () => {
    if (!window.CC || !window.CC.state) return;
    const { db, state, showToast } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u) return;
    if (u.blocked) return showToast("⛔ Tu cuenta está bloqueada");

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === u.cedula);
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

    const avail = getAvailableLevelsUpTo(maxLvl);
    const rule = avail.find(r => r.level === chosenLvl);
    if (!rule) return;

    const quotas = Math.min(rule.quotas, Math.max(1, Number(qSel?.value || rule.quotas)));
    const totalDue = Number((rule.amount * (1 + rule.interest / 100)).toFixed(2));
    const quotaAmount = Number((totalDue / quotas).toFixed(2));
    const loanId = "LN_" + Date.now();

    const loanObj = {
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
    };

    await setDocMulti(docMulti(db, "loans", loanId), loanObj);

    if (window.sendOwnerTelegramAlert) {
      const title = `Crédito Adicional Solicitado ➕💸`;
      const body = `${u.nombre} (V-${u.cedula}) ya tiene un préstamo activo y pidió otro de Nivel ${chosenLvl} (${rule.name}) por $${rule.amount.toFixed(2)} USD en ${quotas} cuota(s).`;
      await window.sendOwnerTelegramAlert(`<b>${title}</b>\n${body}`, title, body);
    }

    showToast("✅ Solicitud de crédito adicional enviada");
  };

  function syncAdditionalLoanUI() {
    if (!window.CC || !window.CC.state || !window.CC.state.loadedCfg) return;
    const { state } = window.CC;
    const viewClient = document.getElementById("viewClient");
    const actBox = document.getElementById("cliActiveLoanBox");
    if (!viewClient || viewClient.classList.contains("hidden") || !actBox) return;

    const u = state.users[state.currentUserCedula];
    if (!u) return;

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === u.cedula);
    const activeLoans = myLoans
      .filter(l => ["activo", "pagando"].includes(l.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    const hasPending = myLoans.some(l => l.status === "pendiente");

    let switcher = document.getElementById("multiLoanSwitcher");
    if (activeLoans.length > 1) {
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

    let addCard = document.getElementById("cliExtraParallelCard");
    if (activeLoans.length >= 1 && !u.blocked) {
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
              <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('extraParallelForm').classList.toggle('hidden');updateExtraLoanCalc();">
                Solicitar
              </button>
            </div>
            <div style="font-size:12px;color:var(--muted);">
              Puedes solicitar un crédito adicional en tu nivel actual (<strong>Nivel ${u.level}</strong>) o en un nivel inferior.
            </div>
            <div id="extraParallelForm" class="hidden" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;">
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
  }

  window._selectClientLoan = (id) => {
    selectedActiveLoanId = id;
    if (window.CC && window.CC.refreshUI) window.CC.refreshUI();
  };

  setInterval(syncAdditionalLoanUI, 1200);
})();
// ============================================================
// AJUSTE FINAL: INTERÉS REAL (22%) Y LÍMITE DE 1 CRÉDITO EXTRA
// ============================================================
(function fijarInteresYLimiteAdicional() {
  function obtenerReglaReal(lvl) {
    if (!window.CC || !window.CC.state) return null;
    const cfg = window.CC.state.cfg || {};
    const levels = Array.isArray(cfg.levels) ? cfg.levels : [];
    const r = window.CC.getLevelRule ? window.CC.getLevelRule(lvl) : levels[lvl - 1];
    if (!r) return null;
    const pctReal = Number(r.pct ?? r.interest ?? r.rate ?? r.int ?? r.porcentaje ?? 22);
    return {
      level: lvl,
      name: r.name || `Nivel ${lvl}`,
      amount: Number(r.amount) || 0,
      interest: pctReal,
      quotas: Number(r.quotas) || 1,
      freq: r.freq || "semanal"
    };
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
    const rule = obtenerReglaReal(chosenLvl);
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
      Total a pagar (${rule.interest}% interés): <strong>$${totalDue.toFixed(2)} USD</strong> en <strong>${quotas} cuota(s) de $${perQuota.toFixed(2)}</strong>
    `;
  };

  const origSubmit = window.submitExtraParallelLoan;
  window.submitExtraParallelLoan = async () => {
    if (!window.CC || !window.CC.state) return;
    const { state, showToast } = window.CC;
    const u = state.users[state.currentUserCedula];
    if (!u) return;

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === u.cedula);
    const activeCount = myLoans.filter(l => ["activo", "pagando"].includes(l.status)).length;
    if (activeCount >= 2) {
      return showToast("⛔ Ya tienes tu crédito principal y 1 adicional activo");
    }

    const lvlSel = document.getElementById("extraLoanLevelSel");
    const chosenLvl = Number(lvlSel?.value || 1);
    const rule = obtenerReglaReal(chosenLvl);
    if (rule) {
      const levels = state.cfg?.levels;
      if (Array.isArray(levels) && levels[chosenLvl - 1]) {
        levels[chosenLvl - 1].interest = rule.interest;
      }
    }
    if (origSubmit) await origSubmit();
  };

  setInterval(() => {
    if (!window.CC || !window.CC.state) return;
    const { state } = window.CC;
    const u = state.users[state.currentUserCedula];
    const addCard = document.getElementById("cliExtraParallelCard");
    if (!u || !addCard) return;

    const myLoans = Object.values(state.loans || {}).filter(l => l.cedula === u.cedula);
    const activeCount = myLoans.filter(l => ["activo", "pagando"].includes(l.status)).length;
    if (activeCount >= 2) {
      addCard.remove();
    }
  }, 800);
})();
