#!/usr/bin/env node
"use strict";

// notify/discord.js — Discord webhook transport (ADR-015). HTTPS POST via the
// shared postJson helper in runtime/notify.js; payload is a single embed
// containing the scrubbed receipt rendered as a code block.

const { canonicalJson } = require("../canonical-json");
const { postJson } = require("../notify");

const URL_PREFIX = "https://discord.com/api/webhooks/";

function buildPayload(event) {
  const ev = event || {};
  const scrubbed = ev.scrubbedReceipt || {};
  const receiptJson = canonicalJson(scrubbed);
  return {
    embeds: [{
      title: `[${(ev.severity || "info").toUpperCase()}] ${ev.kind || "notify"}`,
      description: String(ev.summary || "").slice(0, 1800),
      fields: [
        { name: "action", value: String(scrubbed.action || ""), inline: true },
        { name: "riskLevel", value: String(scrubbed.riskLevel || ""), inline: true },
        { name: "decisionKey", value: String(ev.decisionKey || scrubbed.decisionKey || ""), inline: false },
        { name: "receipt", value: "```json\n" + receiptJson.slice(0, 1500) + "\n```", inline: false },
      ],
    }],
  };
}

function _urlAllowed(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.startsWith(URL_PREFIX)) return true;
  if (process.env.HORUS_NOTIFY_INSECURE === "1" && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) return true;
  return false;
}

async function send(channel, event) {
  const url = String((channel && channel.webhookUrl) || "");
  if (!_urlAllowed(url)) return { ok: false, status: 0, error: "invalid-discord-webhook-url" };
  return postJson(url, canonicalJson(buildPayload(event)));
}

module.exports = { send, buildPayload, URL_PREFIX };
