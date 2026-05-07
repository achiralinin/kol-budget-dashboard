// === CONFIG ===
const SHEET_ID = "1QnGzBIvHHHb1R1hEh49c4ZIhkJ1OHr3Qr8ifQPuNqVY";
const API_KEY = "AIzaSyCmg3dl1ySRqFwP7Pdx_DS2yxmqFZbUjno";
const CREDIT_DAYS = 60;
const ALL_VALUE = "__all__";

// === STATE ===
let projects = []; // [{ gid, name }]
let currentItems = []; // items for current selection
const charts = {};

// === CSV PARSER ===
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// === HELPERS ===
function parseBudget(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDate(d) {
  if (!d) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

function formatBaht(n) {
  return "฿" + Math.round(n).toLocaleString("en-US");
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// === PARSE ROWS INTO ITEMS ===
function parseData(rows, projectName) {
  const items = [];
  let schema = null;
  for (const row of rows) {
    if (!row || row.every((c) => !c || !c.trim())) { schema = null; continue; }
    const first = (row[0] || "").trim();
    if (first === "#") {
      schema = row.map((c) => (c || "").trim());
      continue;
    }
    if (!schema) continue;
    if (!/^\d+$/.test(first)) continue;

    const obj = {};
    schema.forEach((h, i) => { obj[h] = (row[i] || "").trim(); });

    const hasPostDate = schema.includes("Post Date");
    const postDate = hasPostDate ? parseDate(obj["Post Date"]) : null;
    const payDate = parseDate(obj["DATE (วันจ่าย)"] || "");
    let dueDate = payDate;
    if (!dueDate && postDate) {
      dueDate = new Date(postDate.getTime() + CREDIT_DAYS * 24 * 60 * 60 * 1000);
    }

    items.push({
      project: projectName,
      no: obj["#"],
      name: obj["KOLs"] || "",
      type: obj["บุคคล/บริษัท"] || "",
      budget: parseBudget(obj["Budget"]),
      postDate,
      withdrawDate: parseDate(obj["DATE (เบิก)"] || ""),
      payDate,
      dueDate,
      status: obj["Status"] || "",
      hasCreditTerm: hasPostDate,
    });
  }
  return items;
}

function isPaid(item) {
  return item.status.includes("จ่ายแล้ว");
}

// === FETCH ===
async function fetchProjectList() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}&fields=sheets.properties(sheetId,title,index,hidden)`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const list = (data.sheets || [])
    .map((s) => s.properties)
    .filter((p) => !p.hidden)
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ gid: String(p.sheetId), name: p.title }));
  return list;
}

async function fetchSheetItems(gid, name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}&_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`โหลด tab "${name}" ไม่ได้ (HTTP ${res.status})`);
  const text = await res.text();
  return parseData(parseCSV(text), name);
}

// === STATS ===
function computeStats(items) {
  const total = items.reduce((s, x) => s + x.budget, 0);
  const paid = items.filter(isPaid);
  const unpaid = items.filter((x) => !isPaid(x));
  const paidSum = paid.reduce((s, x) => s + x.budget, 0);
  const unpaidSum = unpaid.reduce((s, x) => s + x.budget, 0);

  const today = todayUTC();
  let dueSoon = 0;
  let overdue = 0;
  for (const x of unpaid) {
    if (!x.dueDate) continue;
    const d = daysBetween(today, x.dueDate);
    if (d < 0) overdue++;
    else if (d <= 7) dueSoon++;
  }

  return {
    total, totalCount: items.length,
    paidSum, paidCount: paid.length,
    unpaidSum, unpaidCount: unpaid.length,
    dueSoon, overdue,
  };
}

// === RENDERING ===
function renderStats(s) {
  document.getElementById("stat-total").textContent = formatBaht(s.total);
  document.getElementById("stat-total-count").textContent = `${s.totalCount} รายการ`;
  document.getElementById("stat-paid").textContent = formatBaht(s.paidSum);
  document.getElementById("stat-paid-count").textContent = `${s.paidCount} รายการ`;
  document.getElementById("stat-unpaid").textContent = formatBaht(s.unpaidSum);
  document.getElementById("stat-unpaid-count").textContent = `${s.unpaidCount} รายการ`;
  document.getElementById("stat-due-soon").textContent = `${s.dueSoon} รายการ`;
  document.getElementById("stat-overdue").textContent = `เกินกำหนด: ${s.overdue}`;
}

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  charts[id] = new Chart(ctx, config);
}

function renderCharts(items, stats, isAllView) {
  // Status pie
  makeChart("chart-status", {
    type: "doughnut",
    data: {
      labels: ["จ่ายแล้ว", "ยังไม่จ่าย"],
      datasets: [{
        data: [stats.paidSum, stats.unpaidSum],
        backgroundColor: ["#16a34a", "#ef4444"],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatBaht(c.parsed)}` } },
      },
    },
  });

  // Second chart: type breakdown OR per-project (depending on view)
  const secondPanelTitle = document.querySelector("#chart-type-panel h2");
  if (isAllView) {
    if (secondPanelTitle) secondPanelTitle.textContent = "งบรวมแยกตามโปรเจกต์";
    const byProject = {};
    for (const x of items) {
      const k = x.project || "ไม่ระบุ";
      byProject[k] = (byProject[k] || 0) + x.budget;
    }
    const labels = Object.keys(byProject);
    const values = labels.map((k) => byProject[k]);
    makeChart("chart-type", {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#f43f5e", "#06b6d4", "#84cc16", "#8b5cf6"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${formatBaht(c.parsed)}` } },
        },
      },
    });
  } else {
    if (secondPanelTitle) secondPanelTitle.textContent = "บุคคล vs บริษัท";
    const byType = {};
    for (const x of items) {
      const t = x.type || "ไม่ระบุ";
      byType[t] = (byType[t] || 0) + x.budget;
    }
    const labels = Object.keys(byType);
    const values = labels.map((k) => byType[k]);
    makeChart("chart-type", {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ["#3b82f6", "#a855f7", "#f59e0b", "#64748b"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${formatBaht(c.parsed)}` } },
        },
      },
    });
  }

  // Top 10
  const top = [...items].sort((a, b) => b.budget - a.budget).slice(0, 10);
  makeChart("chart-top", {
    type: "bar",
    data: {
      labels: top.map((x) => x.name),
      datasets: [{
        label: "Budget",
        data: top.map((x) => x.budget),
        backgroundColor: top.map((x) => isPaid(x) ? "#16a34a" : "#ef4444"),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => formatBaht(c.parsed.x),
            afterLabel: (c) => isAllView ? `โปรเจกต์: ${top[c.dataIndex].project}` : "",
          },
        },
      },
      scales: {
        x: { ticks: { callback: (v) => "฿" + (v / 1000) + "k" } },
      },
    },
  });
}

function renderDueTable(items) {
  const today = todayUTC();
  const due = items
    .filter((x) => x.hasCreditTerm && !isPaid(x) && x.dueDate)
    .map((x) => ({ ...x, daysLeft: daysBetween(today, x.dueDate) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const tbody = document.querySelector("#due-table tbody");
  tbody.innerHTML = "";
  if (due.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">— ไม่มีรายการ —</td></tr>`;
    return;
  }
  for (const x of due) {
    const tr = document.createElement("tr");
    let cls = "";
    if (x.daysLeft < 0) cls = "overdue";
    else if (x.daysLeft <= 7) cls = "due-soon";
    tr.className = cls;
    tr.innerHTML = `
      <td>${escape(x.name)}</td>
      <td class="num">${formatBaht(x.budget)}</td>
      <td>${formatDate(x.postDate)}</td>
      <td>${formatDate(x.dueDate)}</td>
      <td class="num">${x.daysLeft < 0 ? "เกิน " + Math.abs(x.daysLeft) : x.daysLeft}</td>
      <td>${statusBadge(x)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function statusBadge(x) {
  if (isPaid(x)) return `<span class="badge paid">จ่ายแล้ว</span>`;
  if (x.status) return `<span class="badge unpaid">${escape(x.status)}</span>`;
  return `<span class="badge unpaid">ยังไม่จ่าย</span>`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

let sortKey = "budget";
let sortDir = "desc";

function renderAllTable(isAllView) {
  const search = document.getElementById("search").value.toLowerCase().trim();
  const fStatus = document.getElementById("filter-status").value;
  const fType = document.getElementById("filter-type").value;

  let filtered = currentItems.filter((x) => {
    if (search && !x.name.toLowerCase().includes(search)) return false;
    if (fStatus === "paid" && !isPaid(x)) return false;
    if (fStatus === "unpaid" && isPaid(x)) return false;
    if (fType !== "all" && x.type !== fType) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    let cmp;
    if (av instanceof Date || bv instanceof Date) {
      cmp = (av?.getTime() || 0) - (bv?.getTime() || 0);
    } else if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "th");
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Toggle project column visibility
  document.querySelectorAll(".project-col").forEach((el) => {
    el.style.display = isAllView ? "" : "none";
  });

  const tbody = document.querySelector("#all-table tbody");
  tbody.innerHTML = "";
  for (const [i, x] of filtered.entries()) {
    const tr = document.createElement("tr");
    const projectCell = isAllView ? `<td class="project-col">${escape(x.project)}</td>` : "";
    tr.innerHTML = `
      <td>${i + 1}</td>
      ${projectCell}
      <td>${escape(x.name)}</td>
      <td>${escape(x.type)}</td>
      <td class="num">${formatBaht(x.budget)}</td>
      <td>${formatDate(x.postDate)}</td>
      <td>${formatDate(x.withdrawDate)}</td>
      <td>${formatDate(x.payDate)}</td>
      <td>${statusBadge(x)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// === PROJECT SELECTION ===
function populateProjectSelect() {
  const sel = document.getElementById("project-select");
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = ALL_VALUE;
  all.textContent = `ภาพรวมทุกโปรเจกต์ (${projects.length})`;
  sel.appendChild(all);
  for (const p of projects) {
    const o = document.createElement("option");
    o.value = p.gid;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  // Restore from URL hash
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const gid = hash.get("gid");
  if (gid && (gid === ALL_VALUE || projects.some((p) => p.gid === gid))) {
    sel.value = gid;
  }
}

async function loadCurrentSelection() {
  const sel = document.getElementById("project-select");
  const value = sel.value;
  const isAllView = value === ALL_VALUE;

  // Update URL hash
  const hash = new URLSearchParams();
  hash.set("gid", value);
  history.replaceState(null, "", "#" + hash.toString());

  document.getElementById("last-updated").textContent = "กำลังโหลด…";
  try {
    if (isAllView) {
      const results = await Promise.all(projects.map((p) => fetchSheetItems(p.gid, p.name)));
      currentItems = results.flat();
    } else {
      const p = projects.find((p) => p.gid === value);
      currentItems = await fetchSheetItems(p.gid, p.name);
    }
    const stats = computeStats(currentItems);
    renderStats(stats);
    renderCharts(currentItems, stats, isAllView);
    renderDueTable(currentItems);
    renderAllTable(isAllView);

    const now = new Date();
    document.getElementById("last-updated").textContent =
      `อัพเดทล่าสุด: ${now.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`;
  } catch (e) {
    showError(e.message);
  }
}

function showError(msg) {
  const errEl = document.getElementById("error");
  errEl.textContent = "โหลดข้อมูลไม่สำเร็จ: " + msg;
  errEl.classList.remove("hidden");
  document.getElementById("last-updated").textContent = "โหลดล้มเหลว";
}

// === MAIN ===
async function init() {
  document.getElementById("error").classList.add("hidden");
  try {
    projects = await fetchProjectList();
    if (projects.length === 0) throw new Error("ไม่พบ tab ใน sheet");
    populateProjectSelect();
    await loadCurrentSelection();
  } catch (e) {
    console.error(e);
    showError(e.message);
  }
}

// Event wiring
document.getElementById("refresh-btn").addEventListener("click", init);
document.getElementById("project-select").addEventListener("change", () => {
  document.getElementById("error").classList.add("hidden");
  loadCurrentSelection();
});
document.getElementById("search").addEventListener("input", () => {
  renderAllTable(document.getElementById("project-select").value === ALL_VALUE);
});
document.getElementById("filter-status").addEventListener("change", () => {
  renderAllTable(document.getElementById("project-select").value === ALL_VALUE);
});
document.getElementById("filter-type").addEventListener("change", () => {
  renderAllTable(document.getElementById("project-select").value === ALL_VALUE);
});
document.querySelectorAll("#all-table th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = key; sortDir = "desc"; }
    renderAllTable(document.getElementById("project-select").value === ALL_VALUE);
  });
});

init();
