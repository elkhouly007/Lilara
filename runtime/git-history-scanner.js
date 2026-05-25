"use strict";

const { spawn } = require("child_process");
const crypto    = require("crypto");
const { scanSecrets, redact } = require("./secret-scan");

// ---------------------------------------------------------------------------
// git-history-scanner.js
// Stream `git log --all -p --no-color` line-by-line and scan every added line
// (+prefix) for secrets using the existing scanSecrets() patterns.
// Deduplicates findings by (secretName + redactedSampleHash) so the same
// leaked secret across multiple commits collapses to one finding with
// firstSeenCommit + lastSeenCommit.
// ---------------------------------------------------------------------------

// Parse the output format from `git log --all -p --no-color`.
// State machine: track current commit context while streaming.
function streamHistory({ cwd, since } = {}) {
  const sinceMs = since ? new Date(since).getTime() : null;
  return new Promise((resolve, reject) => {
    const args = ["log", "--all", "-p", "--no-color", "--format=COMMIT:%H%n%aI%n%aN"];
    if (since) args.push("--after=" + since);

    const git = spawn("git", args, {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let buf = "";
    // Current commit context
    let ctx = { hash: "", dateISO: "", author: "", file: "" };

    // findings map: key → { secretName, firstSeenCommit, lastSeenCommit, author, dateISO, file, lineSnippet }
    const findings = new Map();

    function processLine(line) {
      if (line.startsWith("COMMIT:")) {
        ctx = { hash: line.slice(7).trim(), dateISO: "", author: "", file: "" };
        return;
      }
      // After COMMIT: header, next two lines are ISO date and author name.
      if (ctx.hash && !ctx.dateISO && /^\d{4}-/.test(line)) {
        ctx.dateISO = line.trim();
        // Apply sinceMs post-filter: mark this commit as excluded if it's too old.
        if (sinceMs) {
          const ts = new Date(ctx.dateISO).getTime();
          if (!isNaN(ts) && ts < sinceMs) ctx._excluded = true;
        }
        return;
      }
      if (ctx.hash && ctx.dateISO && !ctx.author && line.trim() && !line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++") && !line.startsWith("@@") && !line.startsWith("+") && !line.startsWith("-")) {
        ctx.author = line.trim();
        return;
      }
      // File path from diff header: +++ b/<file>
      if (line.startsWith("+++ b/")) {
        ctx.file = line.slice(6).trim();
        return;
      }
      // Skip -- /dev/null
      if (line.startsWith("+++ /dev/null")) {
        ctx.file = "";
        return;
      }
      // Only scan added lines
      if (!line.startsWith("+") || line.startsWith("+++")) return;
      // Skip lines from excluded (pre-since) commits
      if (ctx._excluded) return;

      const content = line.slice(1); // remove leading +
      const hit = scanSecrets(content);
      if (!hit) return;

      const redacted = redact(content).slice(0, 80);
      const keyHash  = crypto.createHash("sha1")
        .update(hit.name + "|" + redacted)
        .digest("hex")
        .slice(0, 16);

      if (findings.has(keyHash)) {
        const existing = findings.get(keyHash);
        existing.lastSeenCommit = ctx.hash;
        existing.occurrences    = (existing.occurrences || 1) + 1;
      } else {
        findings.set(keyHash, {
          secretName:      hit.name,
          firstSeenCommit: ctx.hash,
          lastSeenCommit:  ctx.hash,
          author:          ctx.author,
          dateISO:         ctx.dateISO,
          file:            ctx.file,
          lineSnippet:     redacted,
          occurrences:     1,
        });
      }
    }

    git.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop(); // keep incomplete last line
      for (const line of lines) processLine(line);
    });

    git.stdout.on("end", () => {
      if (buf) processLine(buf);
      resolve([...findings.values()]);
    });

    git.on("error", reject);
    git.on("close", (code) => {
      if (code !== 0 && code !== null) {
        // Non-zero exit can mean not a git repo; resolve with empty.
        resolve([...findings.values()]);
      }
    });
  });
}

function toMarkdown(findings) {
  if (findings.length === 0) {
    return "# Secrets in Git History\n\nNo secrets found.\n";
  }
  const lines = ["# Secrets in Git History", ""];
  lines.push(`Found **${findings.length}** unique secret(s).\n`);
  for (const f of findings) {
    lines.push(`## ${f.secretName}`);
    lines.push(`- **First seen**: \`${f.firstSeenCommit.slice(0, 8)}\` (${f.dateISO || "unknown"})`);
    lines.push(`- **Last seen**:  \`${f.lastSeenCommit.slice(0, 8)}\``);
    lines.push(`- **Author**: ${f.author || "unknown"}`);
    lines.push(`- **File**: \`${f.file || "(unknown)"}\``);
    lines.push(`- **Snippet** (redacted): \`${f.lineSnippet}\``);
    lines.push(`- **Occurrences**: ${f.occurrences}`);
    lines.push("");
  }
  lines.push("## Remediation\n");
  lines.push("Use `git filter-repo` or BFG Repo Cleaner to rewrite history and remove the leaked credentials.");
  lines.push("Rotate the exposed secrets immediately.\n");
  return lines.join("\n");
}

async function scanHistory({ since, format, cwd } = {}) {
  const findings = await streamHistory({ since, cwd });
  if (format === "json") return findings;
  return toMarkdown(findings);
}

module.exports = { scanHistory };
