// 共有シート（Google Apps Script）の模擬サーバー（開発用）
// index.html に埋め込んだ Apps Script（id="gasSource"）を、そのまま Node.js の中で動かす。
// SpreadsheetApp などの Google の機能は、メモリ上の表でまねる。
// 使い方: node experimental/sheet-sync/mock-gas-server.mjs [ポート番号]
//   ウェブアプリの URL: http://localhost:ポート/exec   合言葉: test-key
//   /admin/dump?tab=…  …タブの中身を見る
//   /admin/set?tab=…&row=…&col=…&v=…  …シートを手で直したのと同じことをする（row・col は1から）
//   /admin/append?tab=…  （POST で JSON の配列）…シートの最後に手で行を足す
import http from "node:http";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MOCK_KEY = "test-key";

function makeBook() {
  const sheets = [];
  let nextId = 1;
  function makeSheet(name) {
    const cells = []; // [行][列]（0から）
    const sh = {
      name,
      id: nextId++,
      cells,
      getName: () => name,
      getSheetId: () => sh.id,
      getLastRow: () => {
        for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some((x) => x !== "" && x != null)) return r + 1;
        return 0;
      },
      getLastColumn: () => {
        let m = 0;
        cells.forEach((row) => {
          for (let c = (row || []).length - 1; c >= 0; c--)
            if (row[c] !== "" && row[c] != null) {
              m = Math.max(m, c + 1);
              break;
            }
        });
        return m;
      },
      getMaxRows: () => Math.max(1000, cells.length),
      getMaxColumns: () => Math.max(26, ...cells.map((r) => (r || []).length)),
      setFrozenRows() {},
      setColumnWidth() {},
      deleteRow: (r) => cells.splice(r - 1, 1),
      getRange(row, col, nr = 1, nc = 1) {
        const rg = {
          getRow: () => row,
          getDisplayValue: () => String((cells[row - 1] || [])[col - 1] ?? ""),
          getDisplayValues: () => {
            const out = [];
            for (let r = 0; r < nr; r++) {
              const line = [];
              for (let c = 0; c < nc; c++) line.push(String((cells[row - 1 + r] || [])[col - 1 + c] ?? ""));
              out.push(line);
            }
            return out;
          },
          setValue(v) {
            while (cells.length < row) cells.push([]);
            const line = cells[row - 1];
            while (line.length < col) line.push("");
            line[col - 1] = v == null ? "" : String(v);
            return rg;
          },
          setValues(vals) {
            vals.forEach((line, r) =>
              line.forEach((v, c) => sh.getRange(row + r, col + c).setValue(v)),
            );
            return rg;
          },
          setNumberFormat: () => rg,
          setFontWeight: () => rg,
          setBackground: () => rg,
          setFontColor: () => rg,
        };
        return rg;
      },
    };
    return sh;
  }
  const ss = {
    getName: () => "模擬スプレッドシート",
    getUrl: () => "https://docs.google.com/spreadsheets/d/mock/edit",
    getSpreadsheetTimeZone: () => "Asia/Tokyo",
    getSheets: () => sheets.slice(),
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet(n) {
      const s = makeSheet(n);
      sheets.push(s);
      return s;
    },
  };
  return ss;
}

export function loadGas(htmlPath, ss) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = /<script type="text\/plain" id="gasSource">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("gasSource が見つかりません");
  const src = m[1].replace('const KEY = "ここに合言葉";', `const KEY = "${MOCK_KEY}";`);
  const ctx = {
    SpreadsheetApp: { getActive: () => ss },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => [...crypto.createHash("sha256").update(s, "utf8").digest()],
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      formatDate: (d) => d.toISOString().slice(0, 16).replace("T", " ").replace(/-/g, "/"),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__gas = { doGet, doPost };", ctx);
  return ctx.__gas;
}

export function startServer(htmlPath, port = 0) {
  const ss = makeBook();
  const gas = loadGas(htmlPath, ss);
  const stats = { get: 0, post: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
      res.end(body);
    };
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        if (url.pathname === "/exec") {
          const out =
            req.method === "POST"
              ? (stats.post++, gas.doPost({ postData: { contents: body } }))
              : (stats.get++, gas.doGet({ parameter: Object.fromEntries(url.searchParams) }));
          return send(200, out.text);
        }
        const sh = ss.getSheetByName(url.searchParams.get("tab") || "");
        if (url.pathname === "/admin/dump") return send(200, JSON.stringify(sh ? sh.cells : null));
        if (url.pathname === "/admin/set" && sh) {
          sh.getRange(+url.searchParams.get("row"), +url.searchParams.get("col")).setValue(url.searchParams.get("v"));
          return send(200, "{}");
        }
        if (url.pathname === "/admin/append" && sh) {
          const line = JSON.parse(body);
          sh.getRange(sh.getLastRow() + 1, 1, 1, line.length).setValues([line]);
          return send(200, "{}");
        }
        if (url.pathname === "/admin/stats") return send(200, JSON.stringify(stats));
        send(404, "{}");
      } catch (e) {
        console.error(e);
        send(500, JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, ss, stats })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  startServer(path.join(here, "../../index.html"), +(process.argv[2] || 8787)).then(({ port }) =>
    console.log(`模擬サーバー: http://localhost:${port}/exec  合言葉: ${MOCK_KEY}`),
  );
}
