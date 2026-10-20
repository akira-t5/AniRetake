// 共有シートの同期テスト（開発用）。模擬サーバーを立て、index.html を2人分（A・B）同時に開いて試す。
// 実行: node experimental/sheet-sync/test-sync.mjs   （Playwright が必要: npm i playwright）
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer, MOCK_KEY } from "./mock-gas-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "../../index.html");
const { chromium } = await import(process.env.PW_PATH || "playwright");

const { server, port, ss } = await startServer(htmlPath);
const URL_ = `http://localhost:${port}/exec`;
const browser = await chromium.launch();
let failed = 0;
const ok = (cond, name) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + name);
  if (!cond) failed++;
};
const tab = () => ss.getSheetByName("TST_01");
const head = () => tab().cells[1];
const rowOfCut = (cut) => tab().cells.find((r, i) => i > 1 && r[head().indexOf("カット")] === cut);

async function openUser(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => typeof sheetCycle === "function" && !!idb.db);
  await page.evaluate(
    ([url, key, user]) => localStorage.setItem("retake.sheet", JSON.stringify({ url, key, user, eps: {} })),
    [URL_, MOCK_KEY, name],
  );
  return { ctx, page, errs };
}
const cycle = (u) => u.page.evaluate(async () => {
  await sheetCycle();
  while (sheetBusy) await new Promise((r) => setTimeout(r, 50));
});
// 手元のデータを見る
const local = (u) =>
  u.page.evaluate(() =>
    cuts.map((c) => ({ cut: c.cut, subcut: c.subcut, vers: c.versions.map((v) => ({ id: v.id, r: v.r, body: v.body, instr: v.instr, note: v.note, done: !!v.done })) })),
  );
const findCut = async (u, cut) => (await local(u)).find((c) => c.cut === cut);
// 版の項目を直して、自動保存の流れ（schedule）に乗せる
const edit = (u, cut, field, val) =>
  u.page.evaluate(
    ([cut, field, val]) => {
      const c = cuts.find((x) => x.cut === cut);
      latestVer(c)[field] = val;
      renderAll();
      schedule();
    },
    [cut, field, val],
  );

try {
  console.log("1. A が話数を作って共有する");
  const A = await openUser("Aさん");
  await A.page.evaluate(() => {
    $("code").value = "TST";
    $("ep").value = "01";
    const mk = (cut, body, extra) => ({ id: newId("c"), cut, subcut: "", priority: "", selectedVer: 0, versions: [Object.assign(emptyVer(1), { body }, extra || {})] });
    cuts = [mk("001", "口パクずれ"), mk("002", "揺れが強い", { instr: "半分に", done: true }), mk("003", "=1+1 で始まる文"), mk("004", "兼用のテスト", { instr: "+プラスで始まる", note: "'アポストロフィで始まる" })];
    cuts[0].versions.push(Object.assign(emptyVer(2), { body: "2回目", note: "-マイナスで始まる" }));
    selected = 0;
    loadToForm();
    renderAll();
    schedule();
  });
  await A.page.evaluate(() => sheetToggleShare());
  await A.page.waitForFunction(() => !sheetBusy && sheetSt && Object.keys(sheetSt.base).length === 5, null, { timeout: 10000 });
  ok(tab() && tab().cells.length === 2 + 5, "シートに5行（4カット・001は2版）できた");
  ok(rowOfCut("002")[head().indexOf("済")] === "✓" && rowOfCut("002")[head().indexOf("修正内容")] === "半分に", "済・修正内容も書かれた");
  ok(rowOfCut("002")[head().indexOf("更新者")] === "Aさん", "更新者が入った");
  ok(rowOfCut("003")[head().indexOf("リテイク内容")] === "=1+1 で始まる文", "= で始まる文も文字のまま（数式にならない）");
  ok(rowOfCut("004")[head().indexOf("修正内容")] === "+プラスで始まる" && rowOfCut("004")[head().indexOf("備考")] === "'アポストロフィで始まる", "+ ・ ' で始まる文も文字のまま");
  ok(tab().cells.some((r) => r[head().indexOf("備考")] === "-マイナスで始まる"), "- で始まる文も文字のまま");
  ok(tab().forms.every((r) => r.every((f) => !f)), "シートに数式のセルが1つもない");

  console.log("2. B が共有シートから話数を開く");
  const B = await openUser("Bさん");
  await B.page.evaluate(() => sheetOpenTab({ name: "TST_01", title: "作品コード TST　話数 01　AniRetake 共有シート", rows: 5 }));
  await B.page.waitForFunction(() => !sheetBusy && cuts.length === 4, null, { timeout: 10000 });
  const b1 = await local(B);
  ok(b1.map((c) => c.cut).join(",") === "001,002,003,004", "B に4カットが入った（空のカットは外れた）");
  ok(b1[0].vers.length === 2 && b1[1].vers[0].instr === "半分に" && b1[1].vers[0].done, "版・修正内容・済も同じ");
  ok(b1[2].vers[0].body === "=1+1 で始まる文" && b1[3].vers[0].instr === "+プラスで始まる" && b1[3].vers[0].note === "'アポストロフィで始まる" && b1[0].vers.some((v) => v.note === "-マイナスで始まる"), "= + - ' で始まる文が B にも元のまま届く");
  ok(await B.page.evaluate(() => [common().code, common().ep].join("/")) === "TST/01", "B の作品コード・話数が TST/01");
  await cycle(B);
  ok(tab().cells.length === 7, "B が開いても行は増えない");

  console.log("3. A が直す → B に届く");
  await edit(A, "001", "body", "2回目（直した）");
  await cycle(A);
  await cycle(B);
  ok((await findCut(B, "001")).vers.find((v) => v.r === 2).body === "2回目（直した）", "A の変更が B に届いた");

  console.log("4. 別々の項目を直す → 両方残る");
  await edit(A, "002", "note", "A のメモ");
  await edit(B, "002", "instr", "B の修正");
  await cycle(A);
  await cycle(B);
  await cycle(A);
  const a4 = (await findCut(A, "002")).vers[0],
    b4 = (await findCut(B, "002")).vers[0];
  ok(a4.note === "A のメモ" && a4.instr === "B の修正" && b4.note === "A のメモ" && b4.instr === "B の修正", "A・B とも両方の変更が入った");
  ok(await B.page.evaluate(() => sheetSt.conflicts.length) === 0, "衝突にならない");

  console.log("5. 同じ項目を同時に直す → 後の人に衝突");
  await edit(A, "003", "body", "A の文");
  await edit(B, "003", "body", "B の文");
  await cycle(A);
  await cycle(B);
  const cf = await B.page.evaluate(() => sheetSt.conflicts.map((x) => [x.k, x.local, x.remote]));
  ok(cf.length === 1 && cf[0][0] === "body" && cf[0][1] === "B の文" && cf[0][2] === "A の文", "B に衝突が1件（自分 B の文／シート A の文）");
  ok(rowOfCut("003")[head().indexOf("リテイク内容")] === "A の文", "シートは A の文のまま（上書きされない）");
  ok((await B.page.textContent("#sheetState")).includes("衝突 1件"), "上部に「衝突 1件」と出る");
  await cycle(B);
  ok(rowOfCut("003")[head().indexOf("リテイク内容")] === "A の文", "選ぶまでは何度同期しても上書きしない");
  await B.page.evaluate(() => sheetResolve([{ x: sheetSt.conflicts[0], pick: "mine" }]));
  await B.page.waitForFunction(() => !sheetBusy);
  await cycle(B);
  ok(rowOfCut("003")[head().indexOf("リテイク内容")] === "B の文", "「自分」を選ぶとシートが B の文になる");
  await cycle(A);
  ok((await findCut(A, "003")).vers[0].body === "B の文", "A にも B の文が届く");

  console.log("6. A がカットを削除 → B からも消える");
  await A.page.evaluate(() => {
    cuts = cuts.filter((c) => c.cut !== "004");
    selected = 0;
    loadToForm();
    renderAll();
    schedule();
  });
  await cycle(A);
  ok(!rowOfCut("004"), "シートから 004 の行が消えた");
  await cycle(B);
  ok(!(await findCut(B, "004")), "B からも 004 が消えた");

  console.log("7. シートを手で直す・手で行を足す");
  const ri = tab().cells.indexOf(rowOfCut("002"));
  await fetch(`http://localhost:${port}/admin/set?tab=TST_01&row=${ri + 1}&col=${head().indexOf("備考") + 1}&v=${encodeURIComponent("シートで直した")}`);
  const line = head().map((h) => ({ カット: "10", リテイク内容: "シートで足した行", R: "R-01" })[h] || "");
  // シートで手で =… と打つと数式になる（表示は #ERROR!）。アプリには元の文で届くこと
  const ri3 = tab().cells.indexOf(rowOfCut("003"));
  await fetch(`http://localhost:${port}/admin/set?tab=TST_01&row=${ri3 + 1}&col=${head().indexOf("備考") + 1}&v=${encodeURIComponent("=手で打った式")}`);
  await fetch(`http://localhost:${port}/admin/append?tab=TST_01`, { method: "POST", body: JSON.stringify(line) });
  await cycle(A);
  await cycle(B);
  ok((await findCut(A, "002")).vers[0].note === "シートで直した" && (await findCut(B, "002")).vers[0].note === "シートで直した", "シートで直した備考が A・B に入った");
  ok((await findCut(A, "003")).vers[0].note === "=手で打った式" && (await findCut(B, "003")).vers[0].note === "=手で打った式", "シートで手で打った =… が #ERROR! ではなく元の文で届く");
  await cycle(A);
  await cycle(B);
  const a10 = await findCut(A, "010"),
    b10 = await findCut(B, "010");
  ok(!!a10 && !!b10 && a10.vers[0].body === "シートで足した行", "シートで足した行が A・B に1つずつ入った");
  ok(!!a10 && !!b10, "シートで 10 と打った行が、A・B では 010 にそろう");
  ok((await local(A)).filter((c) => /^0*10$/.test(c.cut)).length === 1 && (await local(B)).filter((c) => /^0*10$/.test(c.cut)).length === 1, "足した行が重複しない");
  const r10 = rowOfCut("010");
  ok(!!r10 && !!r10[0] && tab().cells.filter((r) => /^0*10$/.test(r[head().indexOf("カット")])).length === 1, "シートの足した行に ID が書き戻され、カット番号も 010 にそろう（行は1つのまま）");

  console.log("8. オフラインで直す → つながったら送られる");
  await A.ctx.setOffline(true);
  await edit(A, "001", "body", "オフラインで直した");
  await cycle(A);
  ok((await A.page.textContent("#sheetState")).includes("未送信"), "上部に「未送信」と出る：" + (await A.page.textContent("#sheetState")));
  await A.ctx.setOffline(false);
  await cycle(A);
  await cycle(B);
  ok((await findCut(B, "001")).vers.find((v) => v.r === 2).body === "オフラインで直した", "つながったあと B に届いた");

  console.log("9. 入力中の欄は書き換えない");
  await B.page.evaluate(() => {
    selected = cuts.findIndex((c) => c.cut === "002");
    loadToForm();
    $("body").focus();
  });
  await edit(A, "002", "body", "A が入力中に直した");
  await cycle(A);
  await cycle(B);
  ok((await findCut(B, "002")).vers[0].body === "揺れが強い", "B が 002 を入力中は反映しない");
  await B.page.evaluate(() => $("body").blur());
  await cycle(B);
  ok((await findCut(B, "002")).vers[0].body === "A が入力中に直した", "入力をやめたあとの同期で反映");
  ok(rowOfCut("002")[head().indexOf("リテイク内容")] === "A が入力中に直した", "B の古い値でシートを戻さない");

  console.log("10. 再読み込みしても続きから同期できる");
  await B.page.reload();
  await B.page.waitForFunction(() => typeof sheetCycle === "function" && !!idb.db && cuts.length > 1);
  await B.page.waitForFunction(() => !sheetBusy);
  await cycle(B);
  ok(tab().cells.length === 2 + 5 && (await local(B)).length === 4, "行もカットも増えない");
  ok((await findCut(B, "003")).vers[0].body === "B の文", "内容もそのまま");

  console.log("11. 共有をやめたら送らない（JSON読込で置き換えたときと同じ）");
  await A.page.evaluate(() => sheetUnbind(activeEp));
  await edit(A, "001", "body", "共有をやめたあとの変更");
  await A.page.waitForTimeout(3500);
  await cycle(A);
  ok(rowOfCut("001") && tab().cells.every((r) => !r.includes("共有をやめたあとの変更")), "シートは変わらない");
  ok(await A.page.evaluate(() => $("sheetState").hidden), "上部の「共有：」の札が消える");

  console.log("12. 接続テストの表示（合言葉の確認）");
  const ping = (u, url, key) =>
    u.page.evaluate(
      async ([url, key]) => {
        const c = sheetCfg();
        c.url = url;
        c.key = key;
        sheetSaveCfg(c);
        await sheetPing();
        return $("sheetTestOut").textContent;
      },
      [url, key],
    );
  ok((await ping(A, URL_, "  ｔｅｓｔ－ｋｅｙ ")).startsWith("つながりました"), "前後の空白・全角の合言葉でも通る");
  ok((await ping(A, URL_, "ちがう")).startsWith("合言葉が違います"), "違う合言葉 →「合言葉が違います」");
  const unset = await startServer(htmlPath, 0, null);
  ok((await ping(A, `http://localhost:${unset.port}/exec`, "なんでも")).includes("「ここに合言葉」のまま"), "KEY が未設定 →「ここに合言葉のまま」");
  unset.server.close();
  const http = await import("node:http");
  const probe = http.createServer((q, r) => {
    r.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    r.end(JSON.stringify(q.url.includes("key=test-aikotoba") ? { ok: true, method: "GET", sheet: "テスト" } : { ok: false, error: "合言葉が違います" }));
  });
  await new Promise((r) => probe.listen(0, r));
  const pu = `http://localhost:${probe.address().port}/exec`;
  ok((await ping(A, pu, "test-aikotoba")).includes("共有用のスクリプトではありません"), "通信テスト用の URL（合言葉が合う）→ 別のスクリプトと出る");
  ok((await ping(A, pu, "ちがう")).includes("共有用のスクリプトではありません"), "通信テスト用の URL（合言葉が違う）→ 別のスクリプトと出る");
  probe.close();
  const old = http.createServer((q, r) => {
    r.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    r.end(JSON.stringify({ ok: true, name: "前の版", v: 1 }));
  });
  await new Promise((r) => old.listen(0, r));
  const ov = await ping(A, `http://localhost:${old.address().port}/exec`, "x");
  ok(ov.startsWith("つながりました") && ov.includes("古い版"), "前の版のスクリプト → つながるが「古い版」と出る");
  old.close();

  ok(A.errs.length === 0 && B.errs.length === 0, "画面のエラーなし " + JSON.stringify([...A.errs, ...B.errs]));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n失敗 ${failed}件` : "\nすべて成功");
process.exit(failed ? 1 : 0);
