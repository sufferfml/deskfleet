import { createHash } from "node:crypto"
import type { FollowUpDeliveryPolicy, FollowUpRuleMode } from "@deskfleet/protocol/super-agent-follow-up"
import type { CrossWorkerMatch, TurnOutputSource } from "./follow-up-evidence.ts"
import { effectiveCoordinatorProfile } from "./profiles.ts"
import type { SuperCoordinatorOptions } from "@deskfleet/protocol/super-agent"
import type { SuperDecisionModel } from "./router.ts"
import type { SuperStateStore } from "./state.ts"

export type TriageDecisionKind = "record_quietly" | "deliver_result" | "supplement_worker" | "create_ticket" | "ask_human"

export interface TriageDecision {
  kind: TriageDecisionKind
  summary: string
  reason: string
  /** False when the notice informs the user that no formal report/final answer was produced (so run.delivered stays false). */
  reportDelivered?: boolean
  /** Context to deliver to a blocked Worker (only when kind === "supplement_worker"). */
  supplementText?: string
  /** Optional title/scope when escalating into a dedicated ticket. */
  ticketTitle?: string
  ticketScope?: string
  /** Concrete decision choices when kind === "ask_human". */
  options?: string[]
  recommendation?: string
  issueKey?: string
}

export interface TriageInput {
  userId: string
  workspaceId: string
  sourceKind: "schedule" | "session"
  sourceId: string
  sourceTitle: string
  runKey: string
  status: "completed" | "failed" | "interrupted" | "skipped" | "attention"
  deliveryPolicy: FollowUpDeliveryPolicy
  ruleMode: FollowUpRuleMode
  outputText: string
  error?: string
  lastSuccessAt?: string
  consecutiveSkips?: number
  repeatedErrorCount?: number
  issueKey?: string
  stoppedIssueKeys?: string[]
  crossWorkerMatches?: CrossWorkerMatch[]
  relatedSeparateRefs?: CrossWorkerMatch[]
  pendingQuestionText?: string
  hasPendingApproval?: boolean
  prStatusNote?: string
  /** True when the turn's journal transcript could not be read completely through terminal state. */
  evidenceIncomplete?: boolean
  /** True when the execution session has been confirmed deleted from the journal. */
  evidenceDeleted?: boolean
  /** True when the selected output exceeded the capture buffer and kept the concluding range. */
  outputTruncated?: boolean
  /** Provenance/purpose tag of the extracted turn output (distinguishes final_answer vs commentary/ack/milestone). */
  outputSource?: TurnOutputSource
}

export type TriageModel = (packet: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>

/** Compute a deterministic evidence version so the same finding triggers at most one proactive action. */
export function computeEvidenceVersion(parts: (string | number | undefined)[]): string {
  return createHash("sha256").update(parts.map(part => String(part ?? "")).join("\0")).digest("hex").slice(0, 24)
}

/**
 * Bound a delivery summary without dropping the concluding answer at the end.
 * When a long untagged output exceeds `maxChars`, preserve both the opening context and the
 * concluding tail with an explicit truncation notice pointing back to the original session.
 */
export function boundSummaryText(text: string, maxChars = 4000, suffix = ""): string {
  const full = text + suffix
  if (full.length <= maxChars) return full
  const marker = "\n\n... [output truncated; open the original execution session for full details] ...\n\n"
  const available = maxChars - suffix.length - marker.length
  if (available <= 200) {
    const keepTail = Math.max(0, maxChars - suffix.length)
    return text.slice(-keepTail) + suffix
  }
  const headChars = Math.min(1000, Math.floor(available * 0.3))
  const tailChars = available - headChars
  return `${text.slice(0, headChars).trimEnd()}${marker}${text.slice(-tailChars).trimStart()}${suffix}`
}

const EN_ISSUE_NOUN = "(?:changes?|commits?|issues?|risks?|findings?|errors?|failures?|failed|regressions?|warnings?|conflicts?|blockers?|exceptions?|problems?|bugs?|incidents?|anomalies?|alerts?|timeouts?|outages?)"
const EN_NEGATED_RE = new RegExp(
  `\\b(?:no|zero|without|neither|nor)\\s+(?:new\\s+|known\\s+|open\\s+|critical\\s+|blocking\\s+|apparent\\s+|remaining\\s+|significant\\s+|potential\\s+)?${EN_ISSUE_NOUN}(?:\\s*(?:,|\\bor\\b|\\band\\b|\\bnor\\b)\\s*(?:new\\s+|known\\s+|open\\s+|critical\\s+|potential\\s+)?${EN_ISSUE_NOUN})*(?:\\s+(?:found|detected|observed|reported|remaining|present|identified))?\\b`
  + `|\\b(?:0|zero)\\s+${EN_ISSUE_NOUN}\\b`
  + `|\\b${EN_ISSUE_NOUN}\\s*[:：]\\s*(?:0|none|n\\/a|nil|zero|no)\\b`
  + `|\\bfree\\s+of\\s+${EN_ISSUE_NOUN}(?:\\s*(?:,|\\bor\\b|\\band\\b)\\s*${EN_ISSUE_NOUN})*\\b`
  + `|\\bnot\\s+(?:broken|blocked|failing|failed|critical)\\b`
  + `|\\bno\\s+action\\s+(?:needed|required)\\b`,
  "giu",
)
const ZH_ISSUE_NOUN = "(?:新提交|变更|变化|问题|异常|风险|失败|报错|错误|回归|冲突|阻塞|警告|故障|隐患|告警|超时)"
const ZH_NEGATED_RE = new RegExp(
  `(?:无|没有|暂无|未发现|未见|未出现|不存在|零|0\\s*个?)(?:任何|新的?|明显|重大|潜在|已知)?${ZH_ISSUE_NOUN}(?:(?:或|与|和|、|及)(?:任何|新的?|潜在)?${ZH_ISSUE_NOUN})*`
  + `|${ZH_ISSUE_NOUN}\\s*[:：]\\s*(?:无|没有|暂无|未发现|0|零|none)`
  + `|(?:无|没有|未)(?:需要|需)(?:确认|决定|人工介入|处理|操作|关注)`,
  "giu",
)
const JA_NEGATED_RE = /(?:異常|リスク|エラー|失敗|問題|警告|競合)(?:なし|はありません|は見つかりませんでした|0件)/gu

/** Explicit statements that a job/backup/check never executed: an exception even without "error"/"fail" vocabulary. */
const NOT_EXECUTED_RE = /(?:\b(?:did\s*(?:not|n['’]t)|does\s*(?:not|n['’]t)|has\s*(?:not|n['’]t)|have\s*(?:not|n['’]t)|was\s*(?:not|n['’]t)|were\s*(?:not|n['’]t)|never|not\s+yet)\s+(?:been\s+)?(?:run|ran|execute[ds]?|executing|start(?:ed|s)?|complete[ds]?|finish(?:ed|es)?|trigger(?:ed|s)?|happen(?:ed|s)?|perform(?:ed|s)?|kick(?:ed)?\s+off)\b|\bnot\s+(?:executed|performed|triggered|started|completed)\b|未执行|未运行|没有执行|没有运行|没执行|没运行|未启动|未触发|未完成|没有完成|没完成|未能)/iu
const POSITIVE_ANOMALY_RE = /(?:error|fail|failed|failure|risk|regression|warning|broken|conflict|critical|blocked|blocker|exception|bug|incident|outage|timeout|timed\s+out|alert|urgent|immediate(?:ly)?|crash(?:ed)?|unhealthy|degraded|needs?\s+attention|\bhttp\s*[45]\d\d\b|\b(?:429|50[0234])\b|返回\s*[45]\d\d|异常|风险|失败|报错|错误|回归|冲突|阻塞|警告|故障|隐患|告警|超时|宕机|崩溃|中断|不可用|积压|降级|立即处理|紧急|需确认|需要决定|需要人工|待确认|待决定|需立即)/iu
const ACTION_OR_CONTRAST_RE = /(?:\b(?:but|however|though|although|yet|except|otherwise|instead|whereas|unfortunately|caveat|only|partial(?:ly)?|below|less\s+than|fewer\s+than|please|need\s+to|needs?\s+to|should|must|recommend|investigate|fix|patch|pause|halt|rollback|escalate|confirm|approve|follow\s+up|action\s+required|detected|found|discovered|observed|triggered|occurred|happened|increased|decreased|dropped|spiked|elevated|slow(?:er|ed)?|expir(?:ing|ed|y)|backlog|stale|drift|mismatch|missing|changed|modified)\b|但是|但|不过|然而|唯独|除了|却|可惜|需要注意的是|仅|只|只有|仅有|部分|少数|不足|低于|少于|请|需要|需|建议|应当|必须|排查|修复|暂停|回滚|扩容|切换|确认|审批|关注|跟进|处理|联系|重启|升级|发现|出现|存在|发生|触发|导致|引起|新增|变化|变更|变慢|升高|下降|飙升|激增|抖动|波动|过期|即将过期|接近上限|超标|超限|缺失|不一致|滞后|失败率|延迟过高|怪)/iu
const CLEAN_POSITIVE_RE = /(?:nothing\s+to\s+report|all\s+clear|all\s+(?:checks\s+|tests\s+)?passed|everything\s+(?:is\s+|looks\s+)?(?:clean|healthy|ok|normal|green)|looks?\s+clean|status\s*[:：]\s*(?:clean|ok|pass|passed|green|healthy|正常)|一切正常|全部通过|均通过|均正常|运行正常|正常完成|状态\s*[:：]\s*(?:正常|通过|无异常))/giu
const CLEAN_SIGNAL_MATCH_RE = new RegExp(
  `${EN_NEGATED_RE.source}|${ZH_NEGATED_RE.source}|${JA_NEGATED_RE.source}|${CLEAN_POSITIVE_RE.source}`,
  "giu",
)
const BENIGN_FRAMING_RE = /(?:昨日|今日|今天|昨天|本次|每日|定时|任务|巡检|检查|审计|排查|提交|代码|已巡检|已检查|已完成|完成|结束|结果|总结|汇报|报告|状态|结论|均已|均|都|已|巡回|確認|完了|本日|\b(?:daily|nightly|weekly|scheduled|patrol|check|checks|audit|scan|review|summary|report|status|result|results|completed|finished|complete|done|checked|reviewed|inspected|yesterday|today|latest|recent|commits?|changes?|run|task|and|or|with|for|of|in|on|the|is|are|was|were|all|still)\b|\b\d{4}-\d{2}-\d{2}(?:[tT ]\d{2}:\d{2}(?::\d{2})?Z?)?\b)/giu
const CLEAN_PUNCT_SPACE_RE = /[\s,，、.:：\-—–_()（）[\]【】/·•*`'"“”‘’]+/gu
const STANDALONE_NUMERIC_CLAIM_RE = /(?:^|[\s（(，,、:：/])(?:\d+(?:\.\d+)?\s*(?:%|‰|ms|s|秒|笔|条|个|次|项|台|例|件|人|MB|GB|KB)|\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?=\s*(?:of|out\s+of|succeeded|failed|passed|total|笔|条|个|次|项)|$|[\s）)，,、]))/iu
const EN_SUBJECT_ITEM_RE = /^[A-Za-z][A-Za-z0-9._\-\/ ]{0,28}$/u

function stripCleanAndFraming(text: string): { hadClean: boolean; residue: string } {
  let residue = text
  let hadClean = false
  for (const re of [EN_NEGATED_RE, ZH_NEGATED_RE, JA_NEGATED_RE, CLEAN_POSITIVE_RE]) {
    re.lastIndex = 0
    const next = residue.replace(re, " ")
    if (next !== residue) hadClean = true
    residue = next
  }
  const cleaned = residue.replace(BENIGN_FRAMING_RE, " ").replace(CLEAN_PUNCT_SPACE_RE, "")
  return { hadClean, residue: cleaned }
}

/**
 * Validate a subject prefix appearing BEFORE the first clean predicate in a clause
 * (e.g. "支付接口 A、B、C " or "支付和库存" before "全部通过，无异常", or "Payment API A, B, C "
 * before "all checks passed").
 *
 * Strictly rejects:
 * - Chinese clause commas (`，`) which introduce an independent preceding statement (e.g.
 *   "支付 100 笔仅成功 2 笔，库存检查" before "全部通过")
 * - Standalone numeric/metric claims or counts (e.g. "100 笔", "2 笔", "2/100", "2%", "99.9%")
 *   so quantitative findings are handed to the triage model or conservative alert path
 * - English comma clauses that aren't concise pure identifier/service names.
 * - Sentence terminators or negated predicates, which make the prefix an independent statement.
 */
function isBenignCheckedSubjectPrefix(prefix: string): boolean {
  const trimmed = prefix.trim()
  if (!trimmed) return true
  if (trimmed.length > 60) return false
  // Strip benign framing dates/headers first so dates like "2026-11-24" don't look like numeric claims.
  const withoutFraming = trimmed.replace(BENIGN_FRAMING_RE, " ").trim()
  if (!withoutFraming) return true
  // A Chinese comma `，` before the clean verdict indicates an independent preceding clause (NOT a subject list!).
  if (withoutFraming.includes("，")) return false
  // A sentence terminator or a negated predicate means the prefix is its own statement, not a subject label
  // (e.g. "Backups did not run. Inventory:" before "all checks passed").
  if (/[.。!！?？](?:\s|$)/u.test(trimmed)) return false
  if (/\b(?:not|never|no|cannot|unable|(?:did|does|do|is|was|were|are|has|have|had|wo|ca)n['’]t)\b|未|没|不|非|无法/iu.test(trimmed)) return false
  // Independent numeric claims / counts / metrics must NOT be treated as a bare subject label.
  if (STANDALONE_NUMERIC_CLAIM_RE.test(withoutFraming)) return false
  // Parenthetical notes are only allowed if they contain no standalone numeric claims.
  if (/[（(][^）)]*\d[^）)]*[）)]/u.test(withoutFraming)) return false
  // English comma-separated subject lists (e.g. "Payment API A, B, C") must be short pure identifier tokens.
  if (withoutFraming.includes(",")) {
    const parts = withoutFraming.split(",").map(p => p.trim()).filter(Boolean)
    if (parts.length > 8) return false
    return parts.every(part => EN_SUBJECT_ITEM_RE.test(part))
  }
  return withoutFraming.length <= 40
}

/**
 * Determine whether an ENTIRE completed run's text is provably a clean/no-risk report that
 * should remain quiet under `exceptions_only`.
 *
 * Fail-closed rule:
 * 1. Positive anomaly, contrastive pivot, or action/escalation signals anywhere outside negated
 *    phrases always return `false`.
 * 2. Every sentence/clause must either be pure benign framing OR contain an explicit clean verdict
 *    whose trailing text contains only additional clean verdicts/framing and whose leading prefix
 *    (if any) is at most a concise checked-subject/service/metric label.
 */
export function looksCleanNoRisk(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true

  // 1. Strip negated clean phrases first and fail fast on any anomaly, contrast, or action signal.
  const withoutNegated = trimmed
    .replace(EN_NEGATED_RE, " ")
    .replace(ZH_NEGATED_RE, " ")
    .replace(JA_NEGATED_RE, " ")
  if (POSITIVE_ANOMALY_RE.test(withoutNegated) || ACTION_OR_CONTRAST_RE.test(withoutNegated) || NOT_EXECUTED_RE.test(withoutNegated)) {
    return false
  }

  // 2. Verify EVERY clause in the report is provably clean or pure framing.
  // English full stops end an independent statement when followed by whitespace or the end of text;
  // dots inside decimals (99.5%) and identifiers (api.v2) are not boundaries. Same-line and
  // line-separated statements must therefore be judged identically.
  const clauses = trimmed.split(/(?:[。！？!?\n;；]|\.(?=\s|$))+/u).map(part => part.trim()).filter(Boolean)
  if (!clauses.length) return true

  let hadCleanSignal = false
  for (const clause of clauses) {
    const whole = stripCleanAndFraming(clause)
    if (whole.hadClean) hadCleanSignal = true
    if (whole.residue.length === 0) continue

    // If residue remains, this clause MUST itself carry an explicit clean verdict, with only
    // a concise checked-subject label before the first clean verdict and ZERO unexplained text after it.
    CLEAN_SIGNAL_MATCH_RE.lastIndex = 0
    const firstMatch = CLEAN_SIGNAL_MATCH_RE.exec(clause)
    if (!firstMatch) return false
    const prefix = clause.slice(0, firstMatch.index)
    const fromFirstClean = clause.slice(firstMatch.index)
    const tailCheck = stripCleanAndFraming(fromFirstClean)
    if (!tailCheck.hadClean || tailCheck.residue.length > 0) {
      return false
    }
    if (!isBenignCheckedSubjectPrefix(prefix)) {
      return false
    }
    hadCleanSignal = true
  }
  return hadCleanSignal
}

function parseModelDecision(raw: unknown, fallbackSummary: string): TriageDecision | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const kind = obj.kind
  if (kind !== "record_quietly" && kind !== "deliver_result" && kind !== "supplement_worker" && kind !== "create_ticket" && kind !== "ask_human") {
    return undefined
  }
  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary.trim().slice(0, 4000) : fallbackSummary
  const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().slice(0, 1000) : "Coordinator triage"
  const options = Array.isArray(obj.options)
    ? obj.options.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 6)
    : undefined
  return {
    kind,
    summary,
    reason,
    ...(typeof obj.supplementText === "string" && obj.supplementText.trim() ? { supplementText: obj.supplementText.trim().slice(0, 4000) } : {}),
    ...(typeof obj.ticketTitle === "string" && obj.ticketTitle.trim() ? { ticketTitle: obj.ticketTitle.trim().slice(0, 200) } : {}),
    ...(typeof obj.ticketScope === "string" && obj.ticketScope.trim() ? { ticketScope: obj.ticketScope.trim().slice(0, 2000) } : {}),
    ...(options?.length ? { options } : {}),
    ...(typeof obj.recommendation === "string" && obj.recommendation.trim() ? { recommendation: obj.recommendation.trim().slice(0, 1000) } : {}),
    ...(typeof obj.issueKey === "string" && obj.issueKey.trim() ? { issueKey: obj.issueKey.trim().slice(0, 200) } : {}),
  }
}

/**
 * Deterministic-first triage with optional bounded coordinator model escalation.
 * Hard invariants enforced in code:
 * - Never reports a failed/interrupted/unverified run as "no risk".
 * - Respects user-stopped issue keys.
 * - "every_run" always delivers schedules (including zero-change runs).
 * - "exceptions_only" records clean runs quietly without chat spam.
 * - Never grants new permissions or auto-approves native permission prompts.
 */
export async function triageFollowUpEvent(
  input: TriageInput,
  options: { model?: TriageModel; signal?: AbortSignal } = {},
): Promise<TriageDecision> {
  // 1. User previously stopped/dismissed this exact issue -> keep quiet unless it's an explicit every_run schedule report.
  if (input.issueKey && input.stoppedIssueKeys?.includes(input.issueKey) && !(input.sourceKind === "schedule" && input.deliveryPolicy === "every_run")) {
    return {
      kind: "record_quietly",
      summary: input.error || input.outputText.slice(0, 600) || "Repeated signal suppressed after user stop.",
      reason: "User explicitly stopped this issue",
      issueKey: input.issueKey,
    }
  }

  // 2. Native tool approval requests ALWAYS belong to the user (never auto-approved by triage).
  if (input.hasPendingApproval) {
    return {
      kind: "ask_human",
      summary: input.pendingQuestionText || `Execution session "${input.sourceTitle}" is waiting for permission approval.`,
      reason: "Explicit permission request requires human approval",
      issueKey: input.issueKey,
    }
  }

  // 3. Consecutive overlap skips: single skip is quiet history; repeated skips causing missed delivery merge into one issue.
  if (input.status === "skipped") {
    if ((input.consecutiveSkips ?? 1) >= 2) {
      return {
        kind: "deliver_result",
        summary: `Scheduled task "${input.sourceTitle}" was skipped ${input.consecutiveSkips} consecutive times because a previous run is still active.${input.lastSuccessAt ? ` Last successful run: ${input.lastSuccessAt}.` : ""}`,
        reason: "Consecutive overlap skips caused missed scheduled delivery",
        issueKey: input.issueKey ?? `skip:${input.workspaceId}:${input.sourceId}`,
      }
    }
    return {
      kind: "record_quietly",
      summary: input.error || "Skipped overlapping scheduled run.",
      reason: "Single overlap skip recorded in history",
      issueKey: input.issueKey,
    }
  }

  // 4. Execution failures / interruptions: NEVER report as "no risk".
  if (input.status === "failed" || input.status === "interrupted") {
    const errText = input.error?.trim() || (input.status === "interrupted" ? "Execution was interrupted before confirmation." : "Execution failed.")
    const authHint = /delegation|unauthorized|sign.?in|auth|member/iu.test(errText)
      ? " Re-check sign-in or team authorization and rerun."
      : ""
    const lastSuccess = input.lastSuccessAt ? ` Last successful run: ${input.lastSuccessAt}.` : ""
    const repeatNote = (input.repeatedErrorCount ?? 1) > 1 ? ` (Occurred ${input.repeatedErrorCount} times)` : ""
    return {
      kind: "deliver_result",
      summary: `"${input.sourceTitle}" did not complete (${input.status}): ${errText}${repeatNote}.${lastSuccess}${authHint}`,
      reason: "Incomplete or failed execution must surface clearly",
      issueKey: input.issueKey,
    }
  }

  // 5. Blocked Worker with a pending question: check verified cross-Worker evidence first!
  if (input.status === "attention" && input.pendingQuestionText) {
    if (input.crossWorkerMatches?.length) {
      const cited = input.crossWorkerMatches.map(match =>
        `From session "${match.title}" (${match.sessionId}, ${match.prRef.owner}/${match.prRef.repo}#${match.prRef.number}): ${match.summary.slice(0, 600)}`,
      ).join("\n")
      if (options.model) {
        try {
          const raw = await options.model({
            kind: "follow_up_triage",
            sourceKind: input.sourceKind,
            sourceTitle: input.sourceTitle,
            question: input.pendingQuestionText,
            verifiedCrossWorkerEvidence: input.crossWorkerMatches,
            relatedSeparateRefs: input.relatedSeparateRefs,
            prStatusNote: input.prStatusNote,
          }, options.signal)
          const parsed = parseModelDecision(raw, input.pendingQuestionText)
          if (parsed) return parsed
        } catch {
          // Graceful degradation: fall back to deterministic cross-worker handling below.
        }
      }
      // Deterministic safe supplementation when exact repo/PR + objective match exists and no product choice is asked.
      const needsProductDecision = /(?:product|design|prefer|choose|which\s+option|trade-?off|取舍|产品|希望按|选哪|还是按)/iu.test(input.pendingQuestionText)
      if (!needsProductDecision) {
        return {
          kind: "supplement_worker",
          summary: `Supplemented "${input.sourceTitle}" with verified context from ${input.crossWorkerMatches.map(m => `${m.prRef.owner}/${m.prRef.repo}#${m.prRef.number}`).join(", ")}.`,
          supplementText: `Verified context from another Worker on the same PR and objective:\n${cited}`,
          reason: "Verified cross-Worker evidence answers the factual blocker",
          issueKey: input.issueKey,
        }
      }
      return {
        kind: "ask_human",
        summary: `${input.pendingQuestionText}\n\nVerified context:\n${cited}`,
        reason: "Product or policy decision requires human choice",
        issueKey: input.issueKey,
      }
    }
    return {
      kind: "ask_human",
      summary: input.pendingQuestionText,
      reason: "Worker asked a question requiring human input",
      issueKey: input.issueKey,
    }
  }

  // 5b. Sustained silent stall on a running ordinary Worker without a pending question or approval.
  if (input.status === "attention") {
    const detail = input.error?.trim() || "No new progress events were recorded across consecutive periodic checks."
    return {
      kind: "ask_human",
      summary: `"${input.sourceTitle}" appears stalled: ${detail}`,
      reason: "Worker showed no progress across consecutive periodic checks",
      issueKey: input.issueKey ?? `stall:${input.workspaceId}:${input.sourceId}`,
      options: ["Open execution session to inspect", "Continue waiting", "Stop following this stall alert"],
    }
  }

  // 6. Completed runs / turns
  const trimmedOutput = input.outputText.trim()
  const prSuffix = input.prStatusNote ? `\n\nPR status: ${input.prStatusNote}` : ""

  if (input.evidenceDeleted) {
    const deletedSummary = `"${input.sourceTitle}" finished, but its execution session was deleted so the original output is no longer available.${prSuffix}`
    if (input.sourceKind === "session") {
      return {
        kind: "record_quietly",
        summary: deletedSummary.slice(0, 4000),
        reason: "Execution session was confirmed deleted",
      }
    }
    return {
      kind: input.deliveryPolicy === "every_run" ? "deliver_result" : "record_quietly",
      summary: deletedSummary.slice(0, 4000),
      reason: "Execution session was confirmed deleted; surfaced clearly instead of reporting empty output",
      issueKey: input.issueKey ?? `deleted:${input.workspaceId}:${input.sourceId}:${input.runKey}`,
    }
  }

  if (input.evidenceIncomplete) {
    const incompleteSummary = trimmedOutput
      ? `Partial output captured for "${input.sourceTitle}" (full transcript exceeded read limit; open the original execution session for complete details):\n\n${trimmedOutput}${prSuffix}`
      : `"${input.sourceTitle}" finished, but its full turn transcript could not be read completely. Open the original execution session to inspect the complete output.${prSuffix}`
    if (input.sourceKind === "session") {
      return {
        kind: "record_quietly",
        reportDelivered: false,
        summary: incompleteSummary.slice(0, 4000),
        reason: "Ordinary session transcript was only partially read; preserved link to original session",
      }
    }
    return {
      kind: "deliver_result",
      reportDelivered: false,
      summary: incompleteSummary.slice(0, 4000),
      reason: "Scheduled turn transcript was incomplete; surfaced with link to original session instead of treating as empty/clean",
      issueKey: input.issueKey ?? `partial:${input.workspaceId}:${input.sourceId}:${input.runKey}`,
    }
  }

  const truncatedSuffix = input.outputTruncated
    ? "\n\n[Note: Output exceeded capture limit; showing the concluding portion. Open the original execution session for the complete log.]"
    : ""
  const summaryBase = trimmedOutput || "Run completed with no text output."
  const combinedSuffix = truncatedSuffix + prSuffix

  // Guard against treating opening acknowledgements, progress commentary, or partial milestones
  // as a delivered formal report when no final conclusion was produced.
  if (input.outputSource === "ack" || input.outputSource === "commentary") {
    const stageLabel = input.outputSource === "ack" ? "an opening acknowledgement" : "progress commentary"
    const missingConclusionSummary = `"${input.sourceTitle}" finished, but only ${stageLabel} was recorded and no formal final conclusion was produced. Open the original execution session to inspect the full log.${prSuffix}`
    if (input.sourceKind === "session") {
      return {
        kind: "record_quietly",
        reportDelivered: false,
        summary: missingConclusionSummary.slice(0, 4000),
        reason: `Ordinary session turn ended with only ${stageLabel} and no formal final conclusion`,
      }
    }
    return {
      kind: "deliver_result",
      reportDelivered: false,
      summary: missingConclusionSummary.slice(0, 4000),
      reason: `Scheduled run ended with only ${stageLabel} and no formal final conclusion`,
      issueKey: input.issueKey ?? `no-final:${input.workspaceId}:${input.sourceId}:${input.runKey}`,
    }
  }

  if (input.outputSource === "milestone") {
    const milestoneSummary = boundSummaryText(
      `"${input.sourceTitle}" finished with only an intermediate milestone and no formal final conclusion (open the original execution session to inspect the full log):\n\n${summaryBase}`,
      4000,
      combinedSuffix,
    )
    if (input.sourceKind === "session") {
      return {
        kind: "record_quietly",
        reportDelivered: false,
        summary: milestoneSummary,
        reason: "Ordinary session turn ended with only an intermediate milestone and no formal final conclusion",
      }
    }
    return {
      kind: "deliver_result",
      reportDelivered: false,
      summary: milestoneSummary,
      reason: "Scheduled run ended with only an intermediate milestone and no formal final conclusion",
      issueKey: input.issueKey ?? `milestone-only:${input.workspaceId}:${input.sourceId}:${input.runKey}`,
    }
  }

  // A completed scheduled run that produced no assistant text at all: keep the explicit notice and the link to
  // the original session, but never count it as a delivered report.
  if (!trimmedOutput && input.sourceKind === "schedule") {
    return {
      kind: "deliver_result",
      reportDelivered: false,
      summary: boundSummaryText(summaryBase, 4000, combinedSuffix),
      reason: "Scheduled run completed without any text output; no report was produced",
      issueKey: input.issueKey ?? `no-output:${input.workspaceId}:${input.sourceId}:${input.runKey}`,
    }
  }

  // Ordinary session normal completion: record quietly by default unless model/evidence indicates a concrete actionable issue.
  if (input.sourceKind === "session") {
    return {
      kind: "record_quietly",
      summary: boundSummaryText(summaryBase, 4000, combinedSuffix),
      reason: "Ordinary session turn completed normally; recorded for on-demand query",
    }
  }

  // Schedule completed run: apply user's delivery policy.
  if (input.deliveryPolicy === "every_run") {
    if (options.model && !looksCleanNoRisk(summaryBase)) {
      try {
        const raw = await options.model({
          kind: "follow_up_triage",
          sourceKind: "schedule",
          sourceTitle: input.sourceTitle,
          deliveryPolicy: input.deliveryPolicy,
          outputText: boundSummaryText(summaryBase, 6000),
          prStatusNote: input.prStatusNote,
        }, options.signal)
        const parsed = parseModelDecision(raw, boundSummaryText(summaryBase, 4000, combinedSuffix))
        if (parsed && parsed.kind !== "record_quietly") return parsed
      } catch {
        // Model unavailable: deliver deterministic summary so every_run never silently drops.
      }
    }
    return {
      kind: "deliver_result",
      summary: boundSummaryText(summaryBase, 4000, combinedSuffix),
      reason: "Scheduled delivery policy is every_run",
      issueKey: input.issueKey,
    }
  }

  // exceptions_only schedule: clean/no-change runs stay quiet; potential anomalies invoke triage model if available.
  if (!input.outputTruncated && looksCleanNoRisk(summaryBase)) {
    return {
      kind: "record_quietly",
      summary: boundSummaryText(summaryBase, 4000, combinedSuffix),
      reason: "No anomalies detected under exceptions_only policy",
    }
  }

  if (options.model) {
    try {
      const raw = await options.model({
        kind: "follow_up_triage",
        sourceKind: "schedule",
        sourceTitle: input.sourceTitle,
        deliveryPolicy: input.deliveryPolicy,
        outputText: boundSummaryText(summaryBase, 6000),
        prStatusNote: input.prStatusNote,
      }, options.signal)
      const parsed = parseModelDecision(raw, boundSummaryText(summaryBase, 4000, combinedSuffix))
      if (parsed) return parsed
    } catch {
      // Model unavailable: surface the anomaly deterministically so real issues are never missed.
    }
  }

  return {
    kind: "deliver_result",
    summary: boundSummaryText(summaryBase, 4000, combinedSuffix),
    reason: "Potential finding detected under exceptions_only policy",
    issueKey: input.issueKey ?? `finding:${input.workspaceId}:${input.sourceId}:${computeEvidenceVersion([summaryBase.slice(0, 300)])}`,
  }
}

export interface CoordinatorTriageModelDeps {
  superStore: Pick<SuperStateStore, "get">
  providers: () => { id: string; name: string; template?: string }[]
  defaultCoordinator: string
  coordinatorModel: (id: string) => SuperDecisionModel
  coordinatorOptions?: (id: string, model?: string) => Promise<SuperCoordinatorOptions>
}

function tryParseTriageJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const stripped = trimmed.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu, "$1").trim()
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (parseModelDecision(parsed, "triage")) return parsed
  } catch { /* try embedded JSON object below */ }
  const firstBrace = stripped.indexOf("{")
  const lastBrace = stripped.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed: unknown = JSON.parse(stripped.slice(firstBrace, lastBrace + 1))
      if (parseModelDecision(parsed, "triage")) return parsed
    } catch { /* invalid JSON falls back to deterministic rule */ }
  }
  return undefined
}

/**
 * Unwrap either a direct triage decision JSON object or a coordinator `superDecisionSchema` envelope
 * (`{ reason, actions: [{ kind: "answer" | "clarify", text: "<json>" }] }`) into a triage decision payload.
 */
export function extractTriageFromCoordinatorDecision(raw: unknown): unknown {
  if (parseModelDecision(raw, "triage")) return raw
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const actions = (raw as { actions?: unknown }).actions
  if (!Array.isArray(actions)) return undefined
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) continue
    const rec = action as { kind?: unknown; text?: unknown }
    if ((rec.kind === "answer" || rec.kind === "clarify") && typeof rec.text === "string") {
      const extracted = tryParseTriageJson(rec.text)
      if (extracted) return extracted
    }
  }
  return undefined
}

/**
 * Build the production background follow-up `triageModel` resolver on top of the host's configured
 * Super Agent coordinator runtime (`createCoordinatorRuntime`), sharing provider resolution and
 * per-user coordinator model preferences while keeping inference strictly read-only and schema-safe.
 */
export function createCoordinatorTriageModel(deps: CoordinatorTriageModelDeps): (userId: string) => TriageModel | undefined {
  return (userId: string): TriageModel | undefined => {
    const configured = deps.providers()
    if (!configured.length) return undefined
    const state = deps.superStore.get(userId)
    let chosen: { id: string; name: string; template?: string } | undefined
    if (state?.coordinatorProviderId !== undefined) {
      chosen = configured.find(provider => provider.id === state.coordinatorProviderId)
    } else {
      const preferred = configured.filter(provider => (provider.template ?? provider.id) === deps.defaultCoordinator)
      chosen = preferred.length === 1 ? preferred[0] : configured.length === 1 ? configured[0] : undefined
    }
    if (!chosen) return undefined
    const providerId = chosen.id
    const providerTemplate = chosen.template ?? chosen.id
    const overrides = state?.coordinatorOverrides?.[providerId] ?? {}

    return async (packet, signal) => {
      signal?.throwIfAborted()
      let selection = { ...overrides }
      if (deps.coordinatorOptions) {
        try {
          const catalog = await deps.coordinatorOptions(providerId, overrides.model)
          selection = effectiveCoordinatorProfile(providerTemplate, overrides, catalog)
        } catch {
          selection = { ...overrides }
        }
      }
      const wrappedPacket = {
        mode: "background_follow_up_triage",
        message: [
          "Evaluate the untrusted follow-up triage payload in `triage` and decide whether to stay quiet or notify the user.",
          "Never request evidence, never call tools, and never dispatch a worker.",
          "Return exactly one `answer` action whose `text` is ONLY a single raw JSON object (no prose, no markdown fences) matching:",
          '{"kind":"record_quietly"|"deliver_result"|"supplement_worker"|"create_ticket"|"ask_human","summary":"concise user-facing summary in the language of the report","reason":"short factual basis","issueKey":"optional stable issue key"}',
          'Under deliveryPolicy="exceptions_only", choose kind="record_quietly" ONLY when the entire report is clearly normal/within thresholds with no anomaly, failure, risk, or needed action; otherwise choose kind="deliver_result" (or "ask_human" if a user choice is needed) highlighting the exact anomaly or metric breach.',
        ].join("\n"),
        triage: packet,
      }
      const hasSelection = !!(selection.model || selection.reasoningEffort)
      const raw = await deps.coordinatorModel(providerId)(
        wrappedPacket,
        signal,
        undefined,
        hasSelection ? { selection } : undefined,
      )
      return extractTriageFromCoordinatorDecision(raw)
    }
  }
}
