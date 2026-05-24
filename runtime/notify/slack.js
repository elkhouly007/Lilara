#!/usr/bin/env node
"use strict";

// notify/slack.js — Slack incoming-webhook transport (ADR-015). Payload uses
// the Slack `blocks` API; the receipt is rendered as a fenced code block so
// link unfurling and @-mention parsing are inert.

const { canonicalJson } = require("../canonical-json");
const { postJson } = require("../notify");

const URL_PREFIX = "https://hooks.slack.com/services/";

function buildPayload(event) {
  const ev = event || {};
  const scrubbed = ev.scrubbedReceipt || {};
  const receiptJson = canonicalJson(scrubbed);
  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `[${(ev.severity || "info").toUpperCase()}] ${ev.kind || "notify"}` } },
      { type: "section", text: { type: "mrkdwn", text: String(ev.summary || "").slice(0, 2900) } },
      { type: "context", elements: [
        { type: "mrkdwn", text: `*action:* ${String(scrubbed.action || "")}` },
        { type: "mrkdwn", text: `*riskLevel:* ${String(scrubbed.riskLevel || "")}` },
        { type: "mrkdwn", text: `*decisionKey:* ${String(ev.decisionKey || scrubbed.decisionKey || "")}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: "```\n" + receiptJson.slice(0, 2900) + "\n```" } },
    ],
  };
}

function _urlAllowed(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.startsWith(URL_PREFIX)) return true;
  if (process.env.LILARA_NOTIFY_INSECURE === "1" && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) return true;
  return false;
}

async function send(channel, event) {
  const url = String((channel && channel.webhookUrl) || "");
  if (!_urlAllowed(url)) return { ok: false, status: 0, error: "invalid-slack-webhook-url" };
  return postJson(url, canonicalJson(buildPayload(event)));
}

module.exports = { send, buildPayload, URL_PREFIX };
