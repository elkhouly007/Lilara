#!/usr/bin/env node
"use strict";

// notify/email.js — SMTP-over-TLS transport (ADR-015). Hand-rolled minimal
// SMTP client over node:net + node:tls. Zero-dep (nodemailer is a hard stop).
// Credentials live in env (HORUS_SMTP_*); body is text/plain only.

const net = require("node:net");
const tls = require("node:tls");
const { canonicalJson } = require("../canonical-json");

const SOCKET_TIMEOUT_MS = 5000;

function buildMessage(event, to, from) {
  const ev = event || {};
  const subj = `[HAP/${ev.severity || "info"}] ${ev.kind || "notify"}`;
  const body = `${String(ev.summary || "")}\r\n\r\n${canonicalJson(ev.scrubbedReceipt || {})}\r\n`;
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${subj}`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`,
    ``, body,
  ].join("\r\n");
}

async function send(channel, event) {
  const host = process.env.HORUS_SMTP_HOST || "";
  const port = Number(process.env.HORUS_SMTP_PORT || 465) | 0;
  const user = process.env.HORUS_SMTP_USER || "";
  const pass = process.env.HORUS_SMTP_PASS || "";
  const from = process.env.HORUS_SMTP_FROM || user || "horus@localhost";
  const to = String((channel && channel.to) || "");
  if (!host) return { ok: false, status: 0, error: "missing-smtp-host" };
  if (!to)   return { ok: false, status: 0, error: "missing-recipient" };
  const insecure = process.env.HORUS_NOTIFY_INSECURE === "1";
  return _smtpSession({ host, port, user, pass, from, to, message: buildMessage(event, to, from), insecure });
}

function _smtpSession(opts) {
  return new Promise((resolve) => {
    let resolved = false;
    const sock = opts.insecure
      ? net.connect(opts.port, opts.host)
      : tls.connect(opts.port, opts.host, { rejectUnauthorized: process.env.HORUS_NOTIFY_TLS_NOVERIFY !== "1" });
    const done = (r) => { if (resolved) return; resolved = true; try { sock.destroy(); } catch { /* */ } resolve(r); };
    let buf = "";
    let step = 0; // 0:greeting 1:ehlo 2:auth-init 3:auth-user 4:auth-pass 5:mailfrom 6:rcptto 7:data 8:body 9:quit
    const write = (line) => { try { sock.write(line + "\r\n"); } catch (e) { done({ ok: false, status: 0, error: "smtp-write-failed" }); } };
    sock.setTimeout(SOCKET_TIMEOUT_MS);
    sock.on("timeout", () => done({ ok: false, status: 0, error: "smtp-timeout" }));
    sock.on("error", (err) => done({ ok: false, status: 0, error: "smtp-error:" + (err && err.message || "") }));
    sock.on("close", () => { if (step >= 8) return; done({ ok: false, status: 0, error: "smtp-closed-mid-session" }); });
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (!Number.isFinite(code)) return done({ ok: false, status: 0, error: "bad-smtp-line" });
        switch (step) {
          case 0: if (code !== 220) return done({ ok: false, status: code, error: "no-greeting" });
            write("EHLO horus"); step = 1; break;
          case 1: if (code !== 250) return done({ ok: false, status: code, error: "ehlo-failed" });
            if (opts.user) { write("AUTH LOGIN"); step = 2; } else { write(`MAIL FROM:<${opts.from}>`); step = 5; } break;
          case 2: if (code !== 334) return done({ ok: false, status: code, error: "auth-init-failed" });
            write(Buffer.from(opts.user, "utf8").toString("base64")); step = 3; break;
          case 3: if (code !== 334) return done({ ok: false, status: code, error: "auth-user-failed" });
            write(Buffer.from(opts.pass, "utf8").toString("base64")); step = 4; break;
          case 4: if (code !== 235) return done({ ok: false, status: code, error: "auth-pass-failed" });
            write(`MAIL FROM:<${opts.from}>`); step = 5; break;
          case 5: if (code !== 250) return done({ ok: false, status: code, error: "mailfrom-failed" });
            write(`RCPT TO:<${opts.to}>`); step = 6; break;
          case 6: if (code !== 250) return done({ ok: false, status: code, error: "rcptto-failed" });
            write("DATA"); step = 7; break;
          case 7: if (code !== 354) return done({ ok: false, status: code, error: "data-failed" });
            try { sock.write(opts.message + "\r\n.\r\n"); } catch { return done({ ok: false, status: 0, error: "data-write-failed" }); }
            step = 8; break;
          case 8: if (code !== 250) return done({ ok: false, status: code, error: "body-failed" });
            write("QUIT"); step = 9; return done({ ok: true, status: 250, error: null });
          default: break;
        }
      }
    });
  });
}

module.exports = { send, buildMessage, _smtpSession, SOCKET_TIMEOUT_MS };
