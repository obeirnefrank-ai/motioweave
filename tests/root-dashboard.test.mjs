import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the main site address opens the Operations Dashboard", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /redirect\("\/rankflow\/operations\.html"\)/);
  assert.doesNotMatch(page, /rankflow\/index\.html/);
});

test("driver invitations open a text message and hide the unused driver buttons", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/rankflow/operations.html", import.meta.url), "utf8"),
    readFile(new URL("../public/rankflow/operations.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /id="share-driver-button"|id="add-driver-button"|>Share driver app<|>Add driver manually</);
  assert.doesNotMatch(script, /\$\('#(?:share-driver-button|add-driver-button)'\)/);
  assert.doesNotMatch(script, /window\.open\('about:blank','_blank'\)/);
  assert.match(html, /id="open-invite-message"/);
  assert.match(script, /openMessage\.href = smsUrl/);
  assert.match(script, /inviteMessageReady\.hidden = false/);
  assert.match(script, /`sms:\$\{recipient\}\$\{separator\}/);
  assert.doesNotMatch(script, /sms:\$\{encodeURIComponent\(payload\.phoneNumber\)\}/);
});

test("the driver invite provides a simple phone keypad", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../public/rankflow/operations.html", import.meta.url), "utf8"),
    readFile(new URL("../public/rankflow/operations.js", import.meta.url), "utf8"),
    readFile(new URL("../public/rankflow/operations.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="phone-keypad"/);
  assert.match(html, /data-phone-key="backspace"/);
  assert.match(html, /data-phone-key="done"/);
  assert.match(script, /phoneInput\.addEventListener\('focus'/);
  assert.match(script, /phoneInput\.value=phoneInput\.value\.slice\(0,-1\)/);
  assert.match(styles, /\.phone-keypad-grid\s*\{/);
});
