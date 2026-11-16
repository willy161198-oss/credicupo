// ============================================================
// MÓDULO EXTRA: MÉTODOS DE COBRO DEL CLIENTE (BVC 0104, UBII/UVP, PM, BINANCE)
// ============================================================
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function iniciarModuloMetodosCliente() {
  // 1. AGREGAR BVC (0104) AL SELECTOR DE BANCOS DE PAGO MÓVIL
  const bankSel = document.getElementById("regBank");
  if (bankSel && !Array.from(bankSel.options).some(o => o.value === "Venezolano de Crédito (0104)")) {
    const optBvc = document.createElement("option");
    optBvc.value = "Venezolano de Crédito (0104)";
    optBvc.textContent = "Banco Venezolano de Crédito (0104)";
    bankSel.insertBefore(optBvc, bankSel.firstChild);
  }

  // 2. AMPLIAR LAS OPCIONES DE COBRO EN EL REGISTRO DEL CLIENTE
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

    // Caja extra para BVC (0104) y Ubii (UVP)
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

    // Reescribir registro para soportar BVC (PM + Correo) y Ubii (UVP)
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

  // 3. PERMITIR QUE EL CLIENTE YA REGISTRADO CAMBIE SU MÉTODO DE COBRO DESDE SU PANEL
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
      if (histCard) {
        viewClient.insertBefore(card, histCard);
      } else {
        viewClient.appendChild(card);
      }
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

  const obs = new MutationObserver(() => injectClientPayEditor());
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(injectClientPayEditor, 1200);
})();
