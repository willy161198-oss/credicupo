// ============================================================
// MÓDULO COMPLETO EXTRAS - CREDICUPO EXPRESS
// Incluye:
// 1. BVC (0104) con PM/Correo y Ubii Pagos (UVP) para clientes y dueño
// 2. Botón "Cambiar" cuenta de cobro para clientes ya registrados
// 3. Capture de desembolso del dueño al aprobar préstamo
// 4. Notificaciones directas al Telegram del dueño + timbre en vivo
// ============================================================
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function iniciarCrediCupoExtras() {
  let ownerProofDataUrl = "";
  let currentApproveLoanId = null;
  let knownSig = null;

  // ------------------------------------------------------------
  // A. SONIDO DE ALERTA Y ENVÍO DE MENSAJE A TELEGRAM DEL DUEÑO
  // ------------------------------------------------------------
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1174].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.14);
        osc.stop(ctx.currentTime + idx * 0.14 + 0.36);
      });
    } catch (e) {}
  }

  window.sendOwnerTelegramAlert = async (htmlText) => {
    if (!window.CC || !window.CC.state) return;
    const c = window.CC.state.cfg || {};
    const token = (c.tgBotToken || "").trim();
    const chatId = (c.tgOwnerChatId || "").trim();
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
      console.warn("Error enviando alerta Telegram:", err);
    }
  };

  // ------------------------------------------------------------
  // B. MÉTODOS DE COBRO DEL CLIENTE (BVC 0104, UBII/UVP, PM, BINANCE)
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
      <option value="ubii">Ubii Pagos (UVP) • Correo / Pago Móvil</option>
      <option value="binance">Binance Pay (USDT)</option>
    `;

    const customBox = document.createElement("div");
    customBox.id = "regCustomPayBox";
    customBox.className = "hidden";
    customBox.innerHTML = `
      <div id="bvcFieldsWrap" class="hidden">
        <label>Teléfono Pago Móvil BVC (opcional si cobras por correo)</label>
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
        <label>Correo electrónico registrado en Ubii (UVP)</label>
        <input type="email" id="regUbiiMail" placeholder="tucorreo@gmail.com">
        <div class="grid-2">
          <div>
            <label>Teléfono Ubii (opcional)</label>
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
        if (!ubiiMail && !ubiiPhone) return showToast("Escribe tu correo o teléfono de Ubii Pagos");
        const parts = ["Ubii (UVP)"];
        if (ubiiMail) parts.push(`Correo: ${ubiiMail}`);
        if (ubiiPhone) parts.push(`Tel: ${ubiiPhone}`);
        if (ubiiCed) parts.push(`V-${ubiiCed}`);
        payInfo = parts.join(" • ");
      } else {
        const bin = document.getElementById("regBinId").value.trim();
        if (!bin) return showToast("Escribe tu correo o ID de Binance");
        payInfo = `Binance Pay: ${bin}`;
      }

      const userObj = {
        nombre, cedula, phone, pin, method, payInfo, idPhoto,
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
  // C. MODAL PARA QUE EL DUEÑO SUBA CAPTURE AL APROBAR PRÉSTAMO
  // ------------------------------------------------------------
  if (!document.getElementById("ownerDisburseModal")) {
    const modal = document.createElement("div");
    modal.id = "ownerDisburseModal";
    modal.className = "modal-bg hidden";
    modal.onclick = () => modal.classList.add("hidden");
    modal.innerHTML = `
      <div class="modal" onclick="event.stopPropagation()">
        <h3 class="card-title">💸 Aprobar y Subir Capture de Pago</h3>
        <div id="ownerDisbSummary" class="alert alert-info" style="font-size:12px;"></div>

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

      document.getElementById("ownerDisburseModal").classList.add("hidden");
      showToast("✅ Préstamo activado y capture guardado");
    });
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

    document.getElementById("ownerDisbSummary").innerHTML = `
      Cliente: <strong>${l.nombre}</strong> (V-${l.cedula})<br>
      Monto a transferir: <strong>$${Number(l.amount).toFixed(2)} USD (Bs. ${bs})</strong><br>
      Cuenta destino: <strong>${l.payInfo}</strong>
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
  // D. ENGANCHAR NOTIFICACIONES EN SOLICITUDES Y PAGOS DEL CLIENTE
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
      await window.sendOwnerTelegramAlert(
        `🆕 <b>NUEVA SOLICITUD DE PRÉSTAMO</b>\n\n` +
        `👤 Cliente: <b>${u.nombre}</b> (V-${u.cedula})\n` +
        `💵 Monto: <b>$${rule.amount.toFixed(2)} USD</b> (${q} cuotas)\n` +
        `🏦 Cuenta: ${u.payInfo}\n\n` +
        `👉 Abre CrediCupo para aprobar y subir capture.`
      );
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
      await window.sendOwnerTelegramAlert(
        `💰 <b>PAGO DE CUOTA REPORTADO</b>\n\n` +
        `👤 Cliente: <b>${l.nombre}</b> (V-${l.cedula})\n` +
        `📌 Cuota: <b>#${instNum}</b> por <b>$${Number(l.quotaAmount || l.totalDue).toFixed(2)} USD</b>\n` +
        `🧾 Referencia: <b>${refVal}</b>\n\n` +
        `👉 Entra a CrediCupo para verificar el capture y aprobar.`
      );
    };
    wrappedPay._notifWrapped = true;
    window.submitInstallmentPayment = wrappedPay;
  }

  // ------------------------------------------------------------
  // E. CONFIGURACIÓN DEL DUEÑO (BVC, UBII Y TELEGRAM)
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
          🏦 Tus Cuentas Adicionales (BVC 0104 y Ubii / UVP)
        </strong>
        <label style="margin-top:4px;">Banco Venezolano de Crédito (0104) • Pago Móvil</label>
        <input type="text" id="cfgOwnerBvcPm" placeholder="BVC (0104) • V-12345678 • 0414-0000000">
        <label>Banco Venezolano de Crédito • Correo</label>
        <input type="email" id="cfgOwnerBvcMail" placeholder="tucorreo@gmail.com">
        <label>Ubii Pagos (UVP) • Correo / Pago Móvil</label>
        <input type="text" id="cfgOwnerUbii" placeholder="Correo Ubii: tucorreo@gmail.com • Tel: 0414-0000000">
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:10px;width:100%;" onclick="saveExtraAllCfg()">
          Guardar Cuentas BVC y Ubii
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
          🔔 Notificaciones Directas a tu Telegram
        </strong>
        <label style="margin-top:4px;">Token de tu Bot (@BotFather)</label>
        <input type="text" id="cfgTgToken" placeholder="7845123690:AAH...">
        <label>Tu Chat ID de Telegram (@userinfobot)</label>
        <input type="tel" id="cfgTgChatId" placeholder="Ej: 123456789">
        <div class="grid-2" style="margin-top:8px;">
          <button type="button" class="btn btn-sm btn-primary" onclick="saveExtraAllCfg()">Guardar Telegram</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="testTgNotif()">Probar Sonido/Msg</button>
        </div>
      `;
      if (levelsTitle) cfgPane.insertBefore(tgBox, levelsTitle);
      else cfgPane.appendChild(tgBox);
    }
  }

  window.saveExtraAllCfg = async () => {
    if (!window.CC) return;
    const { db, state, showToast } = window.CC;
    const ownerBvcPm = (document.getElementById("cfgOwnerBvcPm")?.value || "").trim();
    const ownerBvcMail = (document.getElementById("cfgOwnerBvcMail")?.value || "").trim();
    const ownerUbii = (document.getElementById("cfgOwnerUbii")?.value || "").trim();
    const tgBotToken = (document.getElementById("cfgTgToken")?.value || "").trim();
    const tgOwnerChatId = (document.getElementById("cfgTgChatId")?.value || "").trim();

    await setDoc(doc(db, "credicupo", "config"), {
      ...state.cfg,
      ownerBvcPm,
      ownerBvcMail,
      ownerUbii,
      tgBotToken,
      tgOwnerChatId
    });
    showToast("✅ Ajustes de bancos y Telegram guardados");
  };

  window.testTgNotif = async () => {
    playChime();
    await window.sendOwnerTelegramAlert("🔔 <b>Prueba exitosa:</b> Así te avisará CrediCupo Express cuando te paguen o pidan un préstamo.");
    if (window.CC) window.CC.showToast("🔔 Alerta de prueba enviada");
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
  // F. EDITOR DE CUENTA DE COBRO DEL CLIENTE YA REGISTRADO
  // ------------------------------------------------------------
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

    if (card.dataset.currentCedula === u.cedula && card.dataset.currentPay === u.payInfo) return;
    card.dataset.currentCedula = u.cedula;
    card.dataset.currentPay = u.payInfo;

    card.innerHTML = `
      <div class="card-title" style="margin-bottom:6px;">
        <span>💳 Tu Cuenta para Recibir Préstamos</span>
        <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('cliPayEditForm').classList.toggle('hidden')">Cambiar</button>
      </div>
      <div style="font-size:12px;color:var(--text);background:#FAFBFC;padding:9px 10px;border-radius:9px;border:1px solid var(--border);">
        <strong>${u.payInfo}</strong>
      </div>
      <div id="cliPayEditForm" class="hidden" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;">
        <label style="margin-top:0;">Nuevo método de cobro</label>
        <select id="updPayType" onchange="toggleUpdPayType()">
          <option value="pm">Pago Móvil (Bs. a tasa BCV)</option>
          <option value="bvc_full">Banco Venezolano de Crédito (0104) • PM y/o Correo</option>
          <option value="ubii">Ubii Pagos (UVP) • Correo / Pago Móvil</option>
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
          <label>Correo electrónico Ubii (UVP)</label>
          <input type="email" id="updUbiiMail" placeholder="tucorreo@gmail.com">
          <label>Teléfono Ubii (opcional)</label>
          <input type="tel" id="updUbiiPhone" placeholder="04141234567">
        </div>

        <div id="updBinFields" class="hidden">
          <label>Correo o Binance Pay ID</label>
          <input type="text" id="updBinId" placeholder="tucorreo@gmail.com o ID">
        </div>

        <button type="button" class="btn btn-primary" onclick="saveClientNewPayMethod()">Guardar Cuenta de Cobro</button>
      </div>
    `;
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
    if (!u) return;

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
      if (!mail && !ph) return showToast("Escribe correo o teléfono de Ubii");
      const parts = ["Ubii (UVP)"];
      if (mail) parts.push(`Correo: ${mail}`);
      if (ph) parts.push(`Tel: ${ph}`);
      parts.push(`V-${u.cedula}`);
      newPayInfo = parts.join(" • ");
    } else {
      const bin = document.getElementById("updBinId").value.trim();
      if (!bin) return showToast("Escribe tu correo o ID de Binance");
      newPayInfo = `Binance Pay: ${bin}`;
    }

    await setDoc(doc(db, "users", u.cedula), { ...u, method: t, payInfo: newPayInfo });
    document.getElementById("cliPayEditForm").classList.add("hidden");
    showToast("✅ Cuenta de cobro actualizada");
  };

  // ------------------------------------------------------------
  // G. SINCRONIZACIÓN EN TIEMPO REAL DE VISTAS Y ALERTAS
  // ------------------------------------------------------------
  function syncAllExtraFeatures() {
    if (!window.CC || !window.CC.state || !window.CC.state.loadedCfg) return;
    const { state, showToast } = window.CC;
    const c = state.cfg;

    injectAdminExtraBoxes();
    injectClientPayEditor();

    // Rellenar inputs del panel de dueño
    const mapInputs = [
      ["cfgOwnerBvcPm", c.ownerBvcPm],
      ["cfgOwnerBvcMail", c.ownerBvcMail],
      ["cfgOwnerUbii", c.ownerUbii],
      ["cfgTgToken", c.tgBotToken],
      ["cfgTgChatId", c.tgOwnerChatId]
    ];
    mapInputs.forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el && !el.dataset.loaded) {
        el.value = val || "";
        el.dataset.loaded = "1";
      }
    });

    // Mostrar cuentas BVC y Ubii en el cuadro de pago del cliente
    const actBox = document.getElementById("cliActiveLoanBox");
    if (actBox && !actBox.classList.contains("hidden")) {
      const infoAlert = actBox.querySelector(".alert.alert-info");
      if (infoAlert && !infoAlert.dataset.extraBanksAdded) {
        let extraLines = "";
        if (c.ownerBvcPm) extraLines += `<br>• BVC (0104) Pago Móvil: <strong>${c.ownerBvcPm}</strong>`;
        if (c.ownerBvcMail) extraLines += `<br>• BVC Correo: <strong>${c.ownerBvcMail}</strong>`;
        if (c.ownerUbii) extraLines += `<br>• Ubii Pagos (UVP): <strong>${c.ownerUbii}</strong>`;
        if (extraLines) infoAlert.innerHTML += extraLines;
        infoAlert.dataset.extraBanksAdded = "1";
      }

      // Botón para que el cliente vea el capture de desembolso del dueño
      if (state.currentUserCedula) {
        const myLoans = Object.values(state.loans)
          .filter(l => l.cedula === state.currentUserCedula && ["activo", "pagando"].includes(l.status))
          .sort((a, b) => b.createdAt - a.createdAt);
        const activeLoan = myLoans[0];
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

    // Botón en el panel del dueño para ver su capture de desembolso guardado
    const admPane = document.getElementById("admPaneLoans");
    if (admPane && !admPane.classList.contains("hidden")) {
      admPane.querySelectorAll(".item-box").forEach(card => {
        if (card.dataset.disbChecked) return;
        card.dataset.disbChecked = "1";
        const delBtn = card.querySelector("button[onclick^='askDeleteLoan']");
        if (!delBtn) return;
        const match = delBtn.getAttribute("onclick").match(/askDeleteLoan\('([^']+)'/);
        if (!match) return;
        const loan = state.loans[match[1]];
        if (loan && loan.disburseProof) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn-sm btn-secondary";
          btn.textContent = "Ver Mi Capture";
          btn.onclick = () => window.openPhoto(loan.disburseProof, `Desembolso a ${loan.nombre} • Ref: ${loan.disburseRef || 'N/A'}`);
          delBtn.parentNode.insertBefore(btn, delBtn);
        }
      });
    }

    // Alerta sonora en vivo si el dueño tiene abierto el panel
    const loansArr = Object.values(state.loans || {});
    const pendCount = loansArr.filter(l => l.status === "pendiente").length;
    const revCount = loansArr.filter(l => l.status === "pagando").length;
    const sig = `${pendCount}-${revCount}`;
    if (knownSig !== null && sig !== knownSig && state.isAdmin) {
      playChime();
      showToast(`🔔 ¡Novedad! (${pendCount} por aprobar • ${revCount} pagos en revisión)`);
    }
    knownSig = sig;
  }

  const obs = new MutationObserver(() => syncAllExtraFeatures());
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(syncAllExtraFeatures, 1200);
})();
