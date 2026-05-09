#!/usr/bin/env node
"use strict";

function checksCommandForStack(primaryStack = "") {
  switch (String(primaryStack || "").trim().toLowerCase()) {
    case "node":
    case "typescript":
      return "horus-cli.sh check && npm test";
    case "python":
      return "horus-cli.sh check && pytest";
    case "golang":
      return "horus-cli.sh check && go test ./...";
    case "rust":
      return "horus-cli.sh check && cargo test";
    case "java":
    case "kotlin":
      return "horus-cli.sh check && ./gradlew test";
    default:
      return "horus-cli.sh check";
  }
}

function recommend(action, input = {}, risk = {}, discovered = {}) {
  const tool = String(input.tool || "").trim().toLowerCase();
  const command = String(input.command || "").toLowerCase();
  const targetPath = String(input.targetPath || "").toLowerCase();
  const branch = String(input.branch || discovered.branch || "").trim();
  const trustPosture = String(input.trustPosture || "balanced").trim().toLowerCase();
  const payloadClass = String(input.payloadClass || "A").trim().toUpperCase();
  const projectRoot = String(input.projectRoot || discovered.projectRoot || "").trim();
  const hasConfig = Boolean(discovered.hasConfig || input.configPath);
  const primaryStack = String(input.primaryStack || discovered.primaryStack || "").trim();
  const sourceLikeTarget = /(^|\/)(src|app|lib|tests?|spec)(\/|$)|\.(js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|cs)$/.test(targetPath);
  const docsLikeTarget = /(^|\/)(docs|references)(\/|$)|\.(md|mdx|txt|rst)$/.test(targetPath);

  const out = {
    lane: null,
    reason: null,
    suggestedSurface: null,
    suggestedTarget: null,
    suggestedCommand: null,
  };

  if (action === "require-tests") {
    out.lane = "verification";
    out.reason = "Risky change should flow through test/verification before continuing.";
    out.suggestedSurface = "checks";
    out.suggestedTarget = "horus-cli.check";
    out.suggestedCommand = "horus-cli.sh check";
    return out;
  }

  if (action === "require-review") {
    out.lane = "review";
    // Tool-aware reason for source-code edits/writes preserves the
    // descriptive contract from the workflow-router source-like branch
    // (lines 119-132). Necessary after ADR-001 D moved F7 from action=block
    // to action=require-review so check-runtime-core's tool-aware reason
    // assertions still hold.
    if (sourceLikeTarget && !docsLikeTarget && /edit|write|multiedit/.test(tool)) {
      out.reason = trustPosture === "strict"
        ? "This target looks like source code, and strict trust posture prefers review before direct code edits continue."
        : (branch && risk.reasons?.includes("protected-branch")
          ? `This target looks like source code on protected branch ${branch}, so direct edits should route through review first.`
          : "This target looks like source code, so direct code edits should route through review first.");
    } else if (sourceLikeTarget && !docsLikeTarget) {
      out.reason = trustPosture === "strict"
        ? "This target looks like source code, and strict trust posture prefers review before direct continuation."
        : (branch && risk.reasons?.includes("protected-branch")
          ? `This target looks like source code on protected branch ${branch}, so it should route through review first.`
          : "Sensitive source-like work should route through review.");
    } else {
      out.reason = branch ? `Protected or sensitive work on branch ${branch} should route through review.` : "Sensitive work should route through review.";
    }
    out.suggestedSurface = "review";
    out.suggestedTarget = "horus-cli.review";
    out.suggestedCommand = "horus-cli.sh review";
    return out;
  }

  if (action === "modify") {
    out.lane = "narrow";
    out.reason = "The runtime wants a safer or narrower form before execution.";
    out.suggestedSurface = "runtime-explain";
    out.suggestedTarget = "horus-cli.runtime.explain";
    out.suggestedCommand = "horus-cli.sh runtime explain --tool <tool> --command '<cmd>' --target <path>";
    return out;
  }

  if (action === "escalate") {
    out.lane = "escalation";
    out.reason = "High-risk action requires human gate before proceeding. Review context carefully before allowing or blocking.";
    out.suggestedSurface = "security-reviewer";
    out.suggestedTarget = "human-gate";
    out.suggestedCommand = null;
    return out;
  }

  if (action === "block") {
    out.lane = "blocked";
    out.reason = "Action is blocked by runtime policy. No workflow route is available — resolve the policy concern first.";
    out.suggestedSurface = "runtime-explain";
    out.suggestedTarget = "horus-cli.runtime.explain";
    out.suggestedCommand = "horus-cli.sh runtime explain --tool <tool> --command '<cmd>' --target <path>";
    return out;
  }

  if (action === "route" || action === "allow") {
    if (/test|lint|pytest|cargo test|npm test|npm run lint/.test(command)) {
      out.lane = "checks";
      out.reason = primaryStack
        ? `This looks like a low-risk verification workflow for a ${primaryStack} project.`
        : "This looks like a low-risk verification workflow.";
      out.suggestedSurface = "checks";
      out.suggestedTarget = "horus-cli.check";
      out.suggestedCommand = checksCommandForStack(primaryStack);
      return out;
    }

    if (payloadClass === "C") {
      out.lane = "review";
      out.reason = "Class C payloads should route through explicit review before any other low-risk workflow choice.";
      out.suggestedSurface = "review";
      out.suggestedTarget = "horus-cli.review";
      out.suggestedCommand = "horus-cli.sh review <file>";
      return out;
    }

    if (payloadClass === "B" && !/classify|redact|payload|prompt|review/.test(command)) {
      out.lane = "payload";
      out.reason = "Class B payloads should go through payload tooling before direct continuation.";
      out.suggestedSurface = "payload-tools";
      out.suggestedTarget = "horus-cli.review";
      out.suggestedCommand = "horus-cli.sh review <file>";
      return out;
    }

    if (sourceLikeTarget && !docsLikeTarget) {
      if (trustPosture === "strict" || risk.reasons?.includes("protected-branch")) {
        out.lane = "review";
        out.reason = trustPosture === "strict"
          ? (/edit|write|multiedit/.test(tool)
            ? "This target looks like source code, and strict trust posture prefers review before direct code edits continue."
            : "This target looks like source code, and strict trust posture prefers review before direct continuation.")
          : (/edit|write|multiedit/.test(tool)
            ? `This target looks like source code on protected branch ${branch}, so direct edits should route through review first.`
            : `This target looks like source code on protected branch ${branch}, so it should route through review first.`);
        out.suggestedSurface = "review";
        out.suggestedTarget = "horus-cli.review";
        out.suggestedCommand = "horus-cli.sh review";
        return out;
      }

      out.lane = "checks";
      out.reason = primaryStack
        ? (/edit|write|multiedit/.test(tool)
          ? `This target looks like source code in a ${primaryStack} project, so direct edits should route through stack-aware checks first.`
          : `This target looks like source code in a ${primaryStack} project, so the safest default route is through stack-aware checks.`)
        : (/edit|write|multiedit/.test(tool)
          ? "This target looks like source code, so direct edits should route through local checks first."
          : "This target looks like source code, so the safest default route is through local checks.");
      out.suggestedSurface = "checks";
      out.suggestedTarget = "horus-cli.check";
      out.suggestedCommand = checksCommandForStack(primaryStack);
      return out;
    }

    if (/classify|redact|payload|prompt/.test(command) || /payload|prompt/.test(targetPath)) {
      out.lane = "payload";
      out.reason = "This looks like payload review/redaction work.";
      out.suggestedSurface = "payload-tools";
      out.suggestedTarget = /redact/.test(command)
        ? "horus-cli.redact"
        : /review/.test(command)
          ? "horus-cli.review"
          : "horus-cli.classify";
      out.suggestedCommand = /redact/.test(command)
        ? "horus-cli.sh redact <file>"
        : /review/.test(command)
          ? "horus-cli.sh review <file>"
          : "horus-cli.sh classify <file>  # or horus-cli.sh redact <file>";
      return out;
    }

    if (/review|audit|code review|security review|pull request|pr\b/.test(command) || /pull_request|\.diff$|\.patch$/.test(targetPath)) {
      out.lane = "review";
      out.reason = "This looks like a review or audit workflow.";
      out.suggestedSurface = "review";
      out.suggestedTarget = "horus-cli.review";
      out.suggestedCommand = "horus-cli.sh review";
      return out;
    }

    if (/install|setup|profile|ecc\.config\.json/.test(command) || /ecc\.config\.json|install-local\.sh|setup-wizard\.sh/.test(targetPath)) {
      const explicitConfigTarget = /ecc\.config\.json/.test(targetPath);
      const shouldGenerateConfig = !hasConfig && !explicitConfigTarget && Boolean(primaryStack);
      out.lane = "setup";
      out.reason = shouldGenerateConfig
        ? `This looks like setup work, and the project shape already looks like ${primaryStack}, so generate config once before install.`
        : hasConfig
          ? "This looks like install or setup workflow work with project config already present."
          : "This looks like install or setup workflow work.";
      out.suggestedSurface = "setup";
      out.suggestedTarget = shouldGenerateConfig ? "horus-cli.generate-config" : (/setup/.test(command) ? "horus-cli.setup" : "horus-cli.install");
      out.suggestedCommand = shouldGenerateConfig
        ? (projectRoot
          ? `bash scripts/generate-config.sh ${projectRoot} --output ${projectRoot}/horus.config.json`
          : "bash scripts/generate-config.sh <project-root> --output <project-root>/horus.config.json")
        : (/setup/.test(command) ? "horus-cli.sh setup" : "horus-cli.sh install <target> --auto");
      return out;
    }

    if (/hook|hooks\.json|settings\.json/.test(targetPath) || /wire/.test(command)) {
      if (trustPosture === "strict" || risk.reasons?.includes("protected-branch")) {
        out.lane = "review";
        out.reason = trustPosture === "strict"
          ? "This looks like hook or settings work, and strict trust posture prefers review before wiring changes continue."
          : `This looks like hook or settings work on protected branch ${branch}, so it should route through review before wiring changes continue.`;
        out.suggestedSurface = "review";
        out.suggestedTarget = "horus-cli.review";
        out.suggestedCommand = "horus-cli.sh review";
        return out;
      }

      out.lane = "wiring";
      out.reason = /edit|write|multiedit/.test(tool)
        ? "This looks like direct hook or settings editing, so route through wiring guidance first."
        : "This looks like hook or tool wiring work.";
      out.suggestedSurface = "wiring";
      out.suggestedTarget = "horus-cli.wire";
      out.suggestedCommand = "horus-cli.sh wire <target>";
      return out;
    }

    out.lane = "direct";
    out.reason = "No special workflow routing is needed beyond the current runtime decision.";
    out.suggestedSurface = "direct";
    out.suggestedTarget = "direct";
    out.suggestedCommand = null;
    return out;
  }

  return out;
}

module.exports = { recommend };
