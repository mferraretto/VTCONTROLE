import { initFirebase } from "./firebase-init.js";

// Garante inicialização do Firebase/Firestore antes de usar window.__vts
initFirebase();

// app.js
// Navegação
const tabs = document.querySelectorAll(".tab");
const panels = {
  importar: document.getElementById("tab-importar"),
  salvos: document.getElementById("tab-salvos"),
  devolucoes: document.getElementById("tab-devolucoes"),
};
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const name = btn.dataset.tab;
  Object.values(panels).forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${name}`).classList.add("active");
  if (name === "salvos") { carregarPedidos(); }
}));

// DOM
const inpLoja   = document.getElementById("inpLoja");
const inpData   = document.getElementById("inpData");
const inpImagem = document.getElementById("inpImagem");
const inpPdf    = document.getElementById("inpPdf");
const inpTexto  = document.getElementById("inpTexto");
const btnProcessarTexto = document.getElementById("btnProcessarTexto");

const outSku      = document.getElementById("outSku");
const outRastreio = document.getElementById("outRastreio");
const outVendaId  = document.getElementById("outVendaId");
const outLoja     = document.getElementById("outLoja");
const outData     = document.getElementById("outData");
const ocrDump     = document.getElementById("ocrDump");
const previewImgs = document.getElementById("previewImgs");
const btnSalvar   = document.getElementById("btnSalvar");
const saveMsg     = document.getElementById("saveMsg");

const filtroBusca = document.getElementById("filtroBusca");
const btnRecarregar = document.getElementById("btnRecarregar");
const btnExportar = document.getElementById("btnExportar");
const tblPedidos  = document.getElementById("tblPedidos").querySelector("tbody");

const devRastreio  = document.getElementById("devRastreio");
const devVendaId   = document.getElementById("devVendaId");
const btnMarcarDevolvido = document.getElementById("btnMarcarDevolvido");
const devMsg = document.getElementById("devMsg");

// Estado
let ocrTextFinal = "";

// Utils de OCR ---------------------------------------------------------------
async function ocrFromImageBlob(blob) {
  const { data: { text } } = await Tesseract.recognize(blob, 'por+eng', {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+/._:()# ÁÂÃÀÉÊÍÓÔÕÚÇçáâãàéêíóôõú%',
  });
  return text;
}

// Renderizar PDF em imagens e rodar OCR página a página
async function tryExtractTextFromPdf(page) {
  try {
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");
    return clean(text);
  } catch (err) {
    console.warn("Falha ao extrair texto direto do PDF, usando OCR", err);
    return "";
  }
}

async function textFromPdf(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("Biblioteca pdf.js não carregada");
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  previewImgs.innerHTML = "";
  let usouOcr = false;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    previewImgs.appendChild(canvas);

    let pageText = await tryExtractTextFromPdf(page);
    if (!pageText || pageText.length < 20) {
      const blob = await new Promise(res => canvas.toBlob(res, "image/png", 0.95));
      if (!blob) continue;
      pageText = await ocrFromImageBlob(blob);
      usouOcr = true;
      fullText += `\n\n---- Página ${i} (OCR) ----\n${pageText}`;
    } else {
      fullText += `\n\n---- Página ${i} ----\n${pageText}`;
    }
  }

  return { text: fullText, usouOcr };
}

// Heurísticas de extração ----------------------------------------------------
function clean(s) { return (s||"").replace(/\s+/g, " ").trim(); }

function firstMatch(regex, text) {
  const m = text.match(regex);
  return m ? clean(m[1] || m[0]) : null;
}

function extractFields(text, lojaDigitada, dataDigitada) {
  // SKU: linha começando com "SKU:" ou padrões tipo T6 / T6+P4+A11 / P1-ROSA
  let sku = null;
  const mSku1 = text.match(/SKU[:\s]*([A-Z0-9+._-]{2,40})/i);
  if (mSku1) sku = clean(mSku1[1]);
  if (!sku) {
    const skuLine = firstMatch(/SKU[^\w]{0,5}([A-Za-zÀ-ÿ0-9+._/ -]{2,80})/i, text);
    if (skuLine) sku = skuLine;
  }
  if (!sku) {
    // tenta achar códigos como T6, T6+P4+A11, P1-ROSA (evita CEP/CPF etc.)
    const cand = text.match(/\b([A-Z0-9]{1,3}(?:[+][A-Z0-9]{1,4})+(?:-[A-Z0-9]+)?|[A-Z]\d{1,3}(?:-[A-Z]+)?|[A-Z0-9]{2,6}-[A-Z0-9]{2,8})\b/g);
    if (cand) {
      // escolhe o mais "rico" (com + ou -)
      cand.sort((a,b)=> (b.match(/[+-]/g)||[]).length - (a.match(/[+-]/g)||[]).length );
      sku = cand[0];
    }
  }

  // Rastreio: padrões BR + dígitos + letra(s) finais
  let rastreio = null;
  const mR = text.match(/\b([A-Z]{2}\d{8,15}[A-Z]{0,2})\b/g);
  if (mR) {
    // Preferir os que começam com BR
    const pref = mR.find(x => x.startsWith("BR"));
    rastreio = pref || mR[0];
  }

  // VendaId: Pack ID: 200000... ou códigos alfanum de 12-20 chars
  let vendaId = null;
  const mPack = text.match(/Pack ID[:\s]*([0-9]{8,20})/i);
  if (mPack) vendaId = mPack[1];
  if (!vendaId) {
    const pedido = firstMatch(/Pedido[:#\s-]*([A-Z0-9-]{6,30})/i, text);
    if (pedido) vendaId = pedido;
  }
  if (!vendaId) {
    const mVenda = text.match(/(?:Venda|Order|ID)[:#\s-]*([A-Z0-9-]{6,24})/i);
    if (mVenda) vendaId = clean(mVenda[1]);
  }
  if (!vendaId) {
    const mCode = text.match(/\b([A-Z0-9]{10,24})\b/g);
    if (mCode) {
      // evitar capturar o rastreio como vendaId; remove se igual ao rastreio
      const filtered = mCode.filter(x => x !== rastreio);
      vendaId = filtered[0] || mCode[0];
    }
  }

  // Loja: campo explícito "Loja: X" senão usa digitado; senão tenta remetente
  let loja = lojaDigitada || null;
  const mLoja = text.match(/Loja[:\s]*([A-Za-zÀ-ÿ0-9 ._-]{2,60})/i);
  if (mLoja) loja = clean(mLoja[1]);
  if (!loja) {
    const candidatoLoja = firstMatch(/(?:Seller|Vendedor|Remetente)[:\s-]*([A-Za-zÀ-ÿ0-9 ._-]{2,60})/i, text);
    if (candidatoLoja) loja = candidatoLoja;
  }
  if (!loja) {
    const mRem = text.match(/Casa Rosa Fest Brasil|Casa Rosa|Matheus|Shopee|Mercado Livre|Amazon/i);
    if (mRem) loja = clean(mRem[0]);
  }

  // Data: dd/mm/aaaa
  let data = dataDigitada || null;
  const mDt = text.match(/\b(\d{2}[\/-]\d{2}[\/-]\d{4})\b/);
  if (mDt) {
    const raw = mDt[1].replace(/-/g, "/");
    data = raw;
  }
  if (!data) {
    const isoDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoDate) {
      const [y,m,d] = isoDate[1].split("-");
      data = `${d}/${m}/${y}`;
    }
  }

  return { sku, rastreio, vendaId, loja, data };
}

// Processadores --------------------------------------------------------------
inpImagem.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  previewImgs.innerHTML = "";
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  previewImgs.appendChild(img);
  saveMsg.textContent = "Lendo imagem com OCR...";
  const text = await ocrFromImageBlob(file);
  ocrTextFinal = text;
  ocrDump.textContent = text;
  preencherCampos(text);
  saveMsg.textContent = "Pronto. Revise e salve.";
});

inpPdf.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  saveMsg.textContent = "Lendo PDF e extraindo texto...";
  try {
    const { text, usouOcr } = await textFromPdf(file);
    ocrTextFinal = text;
    ocrDump.textContent = text;
    preencherCampos(text);
    saveMsg.textContent = usouOcr
      ? "PDF processado com OCR. Revise e salve."
      : "PDF processado. Revise e salve.";
  } catch (err) {
    console.error("Erro ao processar PDF", err);
    saveMsg.innerHTML = `<span class="badge no">Falha ao ler o PDF.</span>`;
  }
});

btnProcessarTexto.addEventListener("click", () => {
  const text = inpTexto.value || "";
  if (!text.trim()) {
    alert("Cole algum texto.");
    return;
  }
  ocrTextFinal = text;
  ocrDump.textContent = text;
  preencherCampos(text);
});

function preencherCampos(text) {
  const lojaDigitada = (document.getElementById("inpLoja").value || "").trim();
  const dataDigitada = (document.getElementById("inpData").value || "").trim();
  const { sku, rastreio, vendaId, loja, data } = extractFields(text, lojaDigitada, dataDigitada);
  if (sku) outSku.value = sku;
  if (rastreio) outRastreio.value = rastreio;
  if (vendaId) outVendaId.value = vendaId;
  if (loja) outLoja.value = loja;
  if (data) outData.value = data;
}

// Salvar no Firestore --------------------------------------------------------
btnSalvar.addEventListener("click", async () => {
  const sku = clean(outSku.value);
  const rastreio = clean(outRastreio.value);
  const vendaId = clean(outVendaId.value);
  const loja = clean(outLoja.value || document.getElementById("inpLoja").value);
  const data = clean(outData.value || document.getElementById("inpData").value);

  if (!sku && !rastreio && !vendaId) {
    alert("Informe pelo menos SKU, rastreio ou venda ID.");
    return;
  }
  const payload = {
    sku: sku || null,
    rastreio: rastreio || null,
    vendaId: vendaId || null,
    loja: loja || null,
    data: data || null,
    ocrText: ocrTextFinal || null,
    devolvido: false,
    criadoEm: window.__vts.serverTimestamp(),
  };

  // Gerar um ID estável (evita duplicados): prioridade vendaId > rastreio > sku+data
  const stable = vendaId || rastreio || `${sku||'SKU'}_${data||Date.now()}`;
  const id = stable.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);

  try {
    const { db, setDoc, doc } = window.__vts || {};
    if (!db) {
      throw new Error("Firestore não inicializado. Verifique sua conexão ou configurações do Firebase.");
    }
    await setDoc(doc(db, "vtsPedidos", id), payload, { merge: true });
    saveMsg.innerHTML = `<span class="badge ok">Salvo!</span> ID: ${id}`;
  } catch (err) {
    console.error("Falha ao salvar no Firestore", err);
    const msg = err?.message || "Não foi possível salvar. Consulte o console do navegador.";
    saveMsg.innerHTML = `<span class="badge no">${msg}</span>`;
  }
});

// Listagem / Export ----------------------------------------------------------
async function carregarPedidos() {
  tblPedidos.innerHTML = "<tr><td colspan='7'>Carregando...</td></tr>";
  try {
    const { db, collection, getDocs, query, orderBy } = window.__vts || {};
    if (!db) {
      throw new Error("Firestore não inicializado.");
    }
    const q = query(collection(db, "vtsPedidos"), orderBy("criadoEm", "desc"));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      rows.push({
        id: docSnap.id,
        data: d.data || "",
        sku: d.sku || "",
        rastreio: d.rastreio || "",
        vendaId: d.vendaId || "",
        loja: d.loja || "",
        devolvido: !!d.devolvido,
        criadoEm: d.criadoEm?.toDate?.()?.toLocaleString?.() || "",
      });
    });

    // filtro
    const term = (filtroBusca.value || "").toLowerCase();
    const filtered = term ? rows.filter(r =>
      Object.values(r).join(" ").toLowerCase().includes(term)
    ) : rows;

    // render
    tblPedidos.innerHTML = "";
    for (const r of filtered.slice(0, 500)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.data}</td>
        <td>${r.sku}</td>
        <td>${r.rastreio}</td>
        <td>${r.vendaId}</td>
        <td>${r.loja}</td>
        <td>${r.devolvido ? "<span class='badge ok'>Sim</span>" : "<span class='badge no'>Não</span>"}</td>
        <td>${r.criadoEm}</td>
      `;
      tblPedidos.appendChild(tr);
    }
  } catch (err) {
    console.error("Falha ao carregar pedidos", err);
    const msg = err?.message || "Não foi possível carregar os pedidos.";
    tblPedidos.innerHTML = `<tr><td colspan='7'><span class="badge no">${msg}</span></td></tr>`;
  }
}
btnRecarregar.addEventListener("click", carregarPedidos);
filtroBusca.addEventListener("input", carregarPedidos);

btnExportar.addEventListener("click", async () => {
  try {
    const { db, collection, getDocs, query, orderBy } = window.__vts || {};
    if (!db) {
      throw new Error("Firestore não inicializado.");
    }
    const q = query(collection(db, "vtsPedidos"), orderBy("criadoEm", "desc"));
    const snap = await getDocs(q);
    const rows = [["data","sku","rastreio","vendaId","loja","devolvido","criadoEm"]];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const dt = d.criadoEm?.toDate?.();
      rows.push([
        d.data||"", d.sku||"", d.rastreio||"", d.vendaId||"", d.loja||"",
        d.devolvido ? "sim" : "não",
        dt ? dt.toISOString() : ""
      ]);
    });
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vts_pedidos.csv"; a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Falha ao exportar pedidos", err);
    alert(err?.message || "Não foi possível exportar os pedidos.");
  }
});

// Devoluções -----------------------------------------------------------------
btnMarcarDevolvido.addEventListener("click", async () => {
  const rastreio = (devRastreio.value || "").trim();
  const vendaId  = (devVendaId.value || "").trim();
  if (!rastreio && !vendaId) {
    alert("Informe rastreio ou venda ID.");
    return;
  }
  devMsg.textContent = "";
  try {
    const { db, collection, getDocs, query, where, setDoc, doc, serverTimestamp } = window.__vts || {};
    if (!db) {
      throw new Error("Firestore não inicializado.");
    }
    let alvoId = null;
    // Tenta por vendaId
    if (vendaId) {
      const q1 = query(collection(db, "vtsPedidos"), where("vendaId", "==", vendaId));
      const s1 = await getDocs(q1);
      if (!s1.empty) alvoId = s1.docs[0].id;
    }
    // Tenta por rastreio
    if (!alvoId && rastreio) {
      const q2 = query(collection(db, "vtsPedidos"), where("rastreio", "==", rastreio));
      const s2 = await getDocs(q2);
      if (!s2.empty) alvoId = s2.docs[0].id;
    }
    if (!alvoId) {
      devMsg.innerHTML = `<span class="badge no">Pedido não encontrado.</span>`;
      return;
    }
    await setDoc(doc(db, "vtsPedidos", alvoId), { devolvido: true, devolvidoEm: serverTimestamp() }, { merge: true });
    devMsg.innerHTML = `<span class="badge ok">Marcado como devolvido!</span> ID: ${alvoId}`;
  } catch (err) {
    console.error("Falha ao marcar devolução", err);
    const msg = err?.message || "Não foi possível atualizar o pedido.";
    devMsg.innerHTML = `<span class="badge no">${msg}</span>`;
  }
});

