/* Local Ledger 記一筆 form (Telegram Mini App). local-ledger-form v2.11.0
 * Static page: no data, no secrets. The bot puts the choices (and the entry to edit) in ?d=, the page sends the
 * answer back with Telegram.WebApp.sendData. The bot checks everything again (ledger/form.py validate).
 * Opened from inline mode (d.x, 2.5.0, a group): sendData does not exist there, so 送出 puts "記帳|…" after
 * "@bot" in the chat's input (switchInlineQuery) and the bot shows it as a card to tap (ledger/inline.py).
 * The top half is plain functions (tested with node: tests/test_form.js); the bottom half draws the page. */
(function (root) {
  "use strict";
  var VERSION = 1;
  var HINT = {
    "食": "食品＆日用品", "衣": "服飾／美容／美髮", "住": "設備／修繕／水電瓦斯網路／貸款", "行": "加油／保養／交通費／停車",
    "育": "學費／育兒／教育", "樂": "旅遊／門票／Game", "醫藥保健": "醫療／個人保險", "其他": "禮金／禮物／稅",
    "薪資": "Salary", "獎金": "Bonus", "其他收入": "Other income"
  };

  function b64urlDecode(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* ?d=... -> the setup from the bot, or null */
  function readSetup(search) {
    var m = /[?&]d=([^&#]+)/.exec(search || "");
    if (!m) return null;
    try {
      var d = JSON.parse(b64urlDecode(decodeURIComponent(m[1])));
      if (!d || d.v !== VERSION || !Array.isArray(d.o) || !Array.isArray(d.ce)) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  function localDate(now) {
    now = now || new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
  }

  /* the starting values of the form */
  function initialState(d, now) {
    if (d.e) {
      return { kind: d.e.kind === "income" ? "income" : "expense", date: d.e.date, owner: d.e.owner, payer: d.e.payer,
               fixed: d.e.fixed ? 1 : 0, category: d.e.category, note: d.e.note || "", currency: d.e.currency || "TWD",
               amount: String(d.e.amount || "").replace(/\.00$/, "") };
    }
    return { kind: "expense", date: localDate(now), owner: d["do"] || d.o[0], payer: d.pa.indexOf(d.me) >= 0 ? d.me : d.pa[0],
             fixed: 0, category: firstCategory(d, "expense"), note: "", amount: "", currency: "TWD" };
  }

  /* 2.9.0: a new expense starts on d.dc (DEFAULT_CATEGORY, 食) when it is in the list; an older bot sends no dc */
  function firstCategory(d, kind) {
    var cats = kind === "income" ? d.ci : d.ce;
    return kind === "expense" && d.dc && cats.indexOf(d.dc) >= 0 ? d.dc : cats[0];
  }

  /* switching 支出 <-> 收入 keeps what still makes sense */
  function switchKind(st, d, kind) {
    var s = Object.assign({}, st, { kind: kind });
    var cats = kind === "income" ? d.ci : d.ce;
    if (cats.indexOf(s.category) < 0) s.category = firstCategory(d, kind);
    if (kind === "income" && s.owner === d.j && !st._ownerTouched) s.owner = d.o.indexOf(d.me) >= 0 && d.me !== d.j ? d.me : d.o[1];
    if (kind === "expense" && s.owner !== d.j && !st._ownerTouched) s.owner = d["do"] || d.j;
    return s;
  }

  function ownersFor(d, kind) {
    return d.o.slice();     /* 收入 can be Joint too (half each); a kid's income is the kid's */
  }

  var TAG = "記帳|", MAX_QUERY = 256;

  /* inline mode: the answer as the inline query ledger/inline.py form_json reads */
  function inlineQuery(st, d) {
    var p = payload(st, Object.assign({}, d, { e: null }));
    return TAG + [p.kind === "income" ? "i" : "e", p.date, p.owner, p.payer || "", p.fixed ? 1 : 0, p.category,
                  p.currency, p.amount, (p.note || "").replace(/\|/g, "／")].join("|");
  }

  /* the same rules as the bot; returns an error text or "" */
  function check(st, d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date || "")) return "請選日期";
    var a = String(st.amount || "").replace(/,/g, "").trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(a) || Number(a) === 0) return "金額要是數字（不能是 0，最多兩位小數；退款按 ± 變負數）";
    if (Math.abs(Number(a)) > (st.currency && st.currency !== "TWD" ? 999999999999.99 : 9999999999.99)) return "金額太大";
    if ((d.cu || ["TWD"]).indexOf(st.currency || "TWD") < 0) return "請選幣別";
    if ((st.kind === "income" ? d.ci : d.ce).indexOf(st.category) < 0) return "請選目錄";
    if (ownersFor(d, st.kind).indexOf(st.owner) < 0) return st.kind === "income" ? "請選是誰的收入" : "請選費用歸屬";
    if (st.kind === "expense" && d.pa.indexOf(st.payer) < 0) return "請選消費方式";
    if ((st.note || "").length > 100) return "Item 最多 100 字";
    if (d.x && inlineQuery(st, d).length > MAX_QUERY) return "內容太長，請縮短 Item";
    return "";
  }

  /* what sendData sends (ledger/form.py validate reads it) */
  function payload(st, d) {
    var p = { v: VERSION, op: d.e ? "edit" : "add", kind: st.kind, date: st.date, owner: st.owner,
              category: st.category, note: (st.note || "").trim(), amount: String(st.amount).replace(/,/g, "").trim(),
              currency: st.currency || "TWD" };
    if (d.e) p.id = d.e.id;
    if (st.kind === "expense") { p.payer = st.payer; p.fixed = st.fixed ? 1 : 0; }
    return p;
  }

  /* ---- 固定支出 items: d.fi = [[id, name, category, owner, payer, currency, amount or null, amountFixed]] */
  function items(d) {
    return (Array.isArray(d.fi) ? d.fi : []).map(function (r) {
      return { id: r[0], name: r[1], category: r[2], owner: r[3], payer: r[4], currency: r[5] || "TWD",
               amount: r[6] === null || r[6] === undefined ? "" : String(r[6]), fixed: r[7] ? 1 : 0 };
    });
  }

  /* picking an item in 常用固定支出 fills the form (the amount stays editable) */
  function applyItem(st, d, it) {
    var s = Object.assign({}, st, { kind: "expense", note: it.name, fixed: 1, currency: it.currency || "TWD",
                                    _item: it.id });
    if (d.ce.indexOf(it.category) >= 0) s.category = it.category;
    if (d.o.indexOf(it.owner) >= 0) { s.owner = it.owner; s._ownerTouched = true; }
    if (d.pa.indexOf(it.payer) >= 0) s.payer = it.payer;
    if ((d.cu || ["TWD"]).indexOf(s.currency) < 0) s.currency = "TWD";
    s.amount = it.amount || "";
    return s;
  }

  function flipSign(a) {
    var t = String(a || "").trim();
    return t.charAt(0) === "-" ? t.slice(1) : "-" + t;
  }

  function money(a, cur) {
    var n = Number(String(a || "").replace(/,/g, ""));
    if (!isFinite(n) || n === 0) return "";
    return (cur && cur !== "TWD" ? cur + " " : "NT$") + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  var api = { readSetup: readSetup, initialState: initialState, switchKind: switchKind, ownersFor: ownersFor,
              check: check, payload: payload, money: money, HINT: HINT, localDate: localDate, VERSION: VERSION,
              items: items, applyItem: applyItem, inlineQuery: inlineQuery, TAG: TAG, flipSign: flipSign };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LedgerForm = api;

  /* ------------------------------------------------------------------ the page */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function start() {
    var tg = root.Telegram && root.Telegram.WebApp;
    var app = document.getElementById("app");
    var d = readSetup(root.location.search);
    if (!d) {
      app.appendChild(el("p", "msg", "這個表單要從 Telegram 開：私訊 bot 時按鍵盤「🧾 表單」，群組裡在輸入框打 @bot 名稱再點「📝 開記帳表單」。"));
      return;
    }
    if (tg) { tg.ready(); tg.expand(); }
    var st = initialState(d);
    var err = el("p", "err", "");

    function chips(items, cur, onPick, labelOf) {
      var box = el("div", "chips");
      items.forEach(function (it) {
        var b = el("button", "chip" + (it === cur ? " on" : ""), labelOf ? labelOf(it) : it);
        b.type = "button";
        b.addEventListener("click", function () { onPick(it); });
        box.appendChild(b);
      });
      return box;
    }

    function field(label, node) {
      var f = el("div", "field");
      f.appendChild(el("label", "", label));
      f.appendChild(node);
      return f;
    }

    function sel(options, cur, labelOf, onChange, cls) {
      var box = el("select", cls || "");
      options.forEach(function (v) {
        var o = el("option", "", labelOf ? labelOf(v) : v); o.value = v;
        if (v === cur) o.selected = true;
        box.appendChild(o);
      });
      box.addEventListener("change", function () { onChange(box.value); });
      return box;
    }

    function render() {
      app.textContent = "";
      var head = el("div", "head");
      head.appendChild(el("h1", "", d.e ? "修改 #" + d.e.id : "記一筆"));
      if (d.e) head.appendChild(el("span", "sub", "原本：" + d.e.date.slice(5).replace("-", "/") + " " + (d.e.note || "") + " " + money(d.e.amount, d.e.currency)));
      app.appendChild(head);
      app.appendChild(chips(["expense", "income"], st.kind, function (k) { st = switchKind(st, d, k); render(); },
                            function (k) { return k === "income" ? "收入" : "支出"; })).className = "chips seg";
      var fis = items(d);
      if (!d.e && fis.length) {
        var pick = el("select", "pick");
        var none = el("option", "", "📌 常用固定支出（點選帶入）"); none.value = "";
        pick.appendChild(none);
        fis.forEach(function (it) {
          var o = el("option", "", it.name + (it.amount ? "　" + money(it.amount, it.currency) : ""));
          o.value = String(it.id);
          if (st._item === it.id) o.selected = true;
          pick.appendChild(o);
        });
        pick.addEventListener("change", function () {
          var it = fis.filter(function (x) { return String(x.id) === pick.value; })[0];
          if (it) { st = applyItem(st, d, it); render(); }
        });
        app.appendChild(field("常用固定支出", pick));
      }

      var date = el("input"); date.type = "date"; date.value = st.date;
      date.addEventListener("change", function () { st.date = date.value; update(); });
      app.appendChild(field("日期", date));

      app.appendChild(field(st.kind === "income" ? "誰的收入" : "費用歸屬",
        chips(ownersFor(d, st.kind), st.owner, function (o) { st.owner = o; st._ownerTouched = true; render(); })));
      if (st.kind === "expense") {
        app.appendChild(field("消費方式（誰付的）", chips(d.pa, st.payer, function (p) { st.payer = p; render(); },
          function (p) { return "By " + p; })));
        app.appendChild(field("消費類別", chips([0, 1], st.fixed, function (f) { st.fixed = f; render(); },
          function (f) { return f ? "固定支出" : "非固定支出"; })));
      }
      var sel = el("select");
      (st.kind === "income" ? d.ci : d.ce).forEach(function (c) {
        var o = el("option", "", c + (HINT[c] ? "　" + HINT[c] : "")); o.value = c;
        if (c === st.category) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { st.category = sel.value; update(); });
      app.appendChild(field(st.kind === "income" ? "收入類別" : "目錄", sel));

      var note = el("input"); note.type = "text"; note.maxLength = 100; note.value = st.note; note.placeholder = "例：午餐";
      note.addEventListener("input", function () { st.note = note.value; });
      app.appendChild(field("Item", note));

      var row = el("div", "money");
      var cur = el("select", "cur");
      (d.cu || ["TWD"]).forEach(function (c) {
        var o = el("option", "", c === "TWD" ? "NT$" : c); o.value = c;
        if (c === (st.currency || "TWD")) o.selected = true;
        cur.appendChild(o);
      });
      cur.addEventListener("change", function () { st.currency = cur.value; render(); });
      var amt = el("input"); amt.type = "text"; amt.inputMode = "decimal"; amt.value = st.amount; amt.placeholder = "0";
      amt.className = "amount " + st.kind;
      amt.addEventListener("input", function () { st.amount = amt.value; update(); });
      /* 2.11.0: a refund is a negative amount; the iPhone number pad has no minus key, so ± flips the sign */
      var flip = el("button", "sign", "±"); flip.type = "button";
      flip.addEventListener("click", function () {
        st.amount = flipSign(st.amount); render();
      });
      row.appendChild(cur); row.appendChild(amt); row.appendChild(flip);
      app.appendChild(field(st.kind === "income" ? "Amount" : "Price", row));
      if (String(st.amount || "").trim().charAt(0) === "-")
        app.appendChild(el("p", "foot", st.kind === "income" ? "負數＝收入扣回" : "負數＝退款／折抵：從這個目錄的支出扣掉"));
      if (d.x) app.appendChild(el("p", "foot", "按下方按鈕後回到聊天：點輸入框上方跳出的預覽卡片，才會記到這個聊天裡"));
      if (st.currency && st.currency !== "TWD") app.appendChild(el("p", "foot", "外幣：bot 用臺灣銀行當天的即期賣出匯率換成台幣；刷卡的話，匯入信用卡帳單後會改成實際刷卡金額"));

      app.appendChild(err);
      if (d.e) {
        var del = el("button", "del", "🗑 刪除這筆"); del.type = "button";
        del.addEventListener("click", function () {
          var go = function (yes) { if (yes) send({ v: VERSION, op: "del", id: d.e.id }); };
          if (tg && tg.showConfirm) tg.showConfirm("刪除 #" + d.e.id + "？", go); else go(root.confirm("刪除 #" + d.e.id + "？"));
        });
        app.appendChild(del);
      }
      app.appendChild(el("p", "foot", "選項由 bot 帶入；送出後 bot 會再檢查一次"));
      if (!tg) app.appendChild(el("p", "msg", "（不在 Telegram 裡，送不出去）"));
      update();
    }

    function label() {
      if (d.e) return "儲存修改";
      var m = money(st.amount, st.currency);
      if (d.x) return "下一步：送到聊天" + (m ? "　" + m : "");
      return (st.kind === "income" ? "記收入" : "記一筆") + (m ? "　" + m : "");
    }

    function update() {
      err.textContent = "";
      if (!tg) return;
      tg.MainButton.setParams({ text: label(), color: st.kind === "income" ? "#34a853" : (tg.themeParams.button_color || "#2481cc"),
                                is_visible: true, is_active: true });
    }

    function send(p) {
      if (d.x) {                         // inline mode (a group): back to the chat's input with the answer
        if (!tg || !tg.switchInlineQuery || !tg.isVersionAtLeast || !tg.isVersionAtLeast("6.7")) {
          err.textContent = "這個 Telegram 版本太舊，請更新 Telegram，或在聊天裡用「📝 記一筆」";
          return;
        }
        tg.switchInlineQuery(inlineQuery(st, d));
        return;
      }
      var s = JSON.stringify(p);
      if (tg) tg.sendData(s);            // closes the form; the bot answers in the chat
    }

    if (tg) {
      tg.MainButton.onClick(function () {
        var e = check(st, d);
        if (e) { err.textContent = e; if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("error"); return; }
        send(payload(st, d));
      });
    }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : this);
