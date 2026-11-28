import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SuperAgentApi } from "@deskfleet/client/desktop-api"
import { getClient } from "@deskfleet/client/platform"
import {
  hexToOklab,
  SA_ACCENT_PALETTE,
  SA_ACCENT_SLOT_COUNT,
  wcagContrastRatio,
  type SuperMessage,
  type SuperSnapshot,
  type SuperTicket,
} from "@deskfleet/protocol/super-agent"
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { createPinia, disposePinia } from "pinia"
import { afterEach, expect, test, vi } from "vitest"
import { ref } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import { accountSessionKey } from "../composables/useAccountSession.ts"
import { platformClientKey } from "../composables/usePlatformClient.ts"
import { i18n } from "../i18n/index.ts"
import { buildWorkspaceTranscript, workspaceMessageRows } from "../services/workspace-message-timeline.ts"
import WorkspaceAgentView from "./WorkspaceAgentView.vue"

const makeTicket = (id: string, title: string, extra: Partial<SuperTicket> = {}): SuperTicket => ({
  id,
  title,
  scope: title,
  summary: "",
  provider: "codex",
  updatedAt: "2026-11-28T06:00:00.000Z",
  ...extra,
})

const makeMessage = (id: string, extra: Partial<SuperMessage> = {}): SuperMessage => ({
  id,
  role: "user",
  text: id,
  createdAt: "2026-11-28T06:00:00.000Z",
  ...extra,
})

const makeRoom = (extra: Partial<SuperSnapshot> = {}): SuperSnapshot => ({
  workspaceId: "ws-archive-fold",
  provider: "codex",
  supportsTicketArchive: true,
  supportsTicketLinks: true,
  supportsStop: true,
  supportsReplyFeedback: true,
  supportsStoppedReEdit: true,
  tickets: [],
  messages: [],
  ...extra,
})

function oklabToHex(l: number, a: number, b: number): string {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3
  const linR = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const linG = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const linB = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  const toSrgb = (c: number) => {
    const clamped = Math.min(1, Math.max(0, c))
    const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(v * 255).toString(16).padStart(2, "0")
  }
  return `#${toSrgb(linR)}${toSrgb(linG)}${toSrgb(linB)}`
}

function mixOklabHex(hexA: string, weightA: number, hexB: string, weightB: number): string {
  const [l1, a1, b1] = hexToOklab(hexA)
  const [l2, a2, b2] = hexToOklab(hexB)
  return oklabToHex(l1 * weightA + l2 * weightB, a1 * weightA + a2 * weightB, b1 * weightA + b2 * weightB)
}

let wrappers: VueWrapper[] = []
let pinia: ReturnType<typeof createPinia> | undefined
const originalLocale = i18n.global.locale.value

async function mountView(
  initial: SuperSnapshot,
  options: { locale?: "zh-cmn-Hans-CN" | "en-US" | "ja-JP"; mobile?: boolean } = {},
) {
  i18n.global.locale.value = options.locale ?? "zh-cmn-Hans-CN"
  let state = initial
  const machines = ref([{ id: "local-daemon", teamId: "team-fold", name: "Studio Mac", online: true }])
  const api: SuperAgentApi = {
    snapshot: vi.fn<SuperAgentApi["snapshot"]>(async () => state),
    stop: vi.fn<NonNullable<SuperAgentApi["stop"]>>(async () => state),
    archiveTicket: vi.fn<NonNullable<SuperAgentApi["archiveTicket"]>>(async ({ ticketId, archived }) => {
      state = {
        ...state,
        tickets: state.tickets.map(item =>
          item.id === ticketId ? { ...item, archiveState: archived ? "archived" : undefined } : item,
        ),
      }
      return state
    }),
    send: vi.fn<SuperAgentApi["send"]>(async request => {
      state = {
        ...state,
        messages: [
          ...state.messages,
          makeMessage(request.messageId, { text: request.text, replyTo: request.replyTo, state: "answered" }),
        ],
      }
      return state
    }),
    correct: vi.fn<SuperAgentApi["correct"]>(async () => state),
    settings: vi.fn<SuperAgentApi["settings"]>(async () => state),
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "new-session", component: {} },
      { path: "/workspaces/:workspaceId/agent", name: "workspace-agent", component: {} },
      { path: "/sessions/:sessionId", name: "session", component: {} },
      { path: "/settings/agents", name: "settings-agents", component: {} },
    ],
  })
  await router.push({ name: "workspace-agent", params: { workspaceId: initial.workspaceId ?? "ws-archive-fold" } })
  pinia = createPinia()
  const wrapper = mount(WorkspaceAgentView, {
    props: { api, workspaceId: initial.workspaceId },
    attachTo: document.body,
    global: {
      plugins: [pinia, i18n, router],
      provide: {
        ...(options.mobile && {
          [platformClientKey as symbol]: { ...getClient(), platform: "web", mobile: true, remoteWorkspaceAgent: true },
        }),
        [accountSessionKey as symbol]: {
          account: ref({ user: { id: "user-fold", name: "Tester", email: "tester@example.test" } }),
          members: ref([]),
          teamId: ref("team-fold"),
          localMachineId: ref("local-daemon"),
          machineId: ref("local-daemon"),
          machines,
        },
      },
      stubs: {
        PaneHeader: { template: '<header><slot/><slot name="actions"/></header>' },
        AgentMarkdown: { props: ["text"], template: "<span>{{ text }}</span>" },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, api, getState: () => state }
}

async function openTicketsPanel(wrapper: VueWrapper) {
  const trigger = wrapper.get("[data-tickets-menu]")
  await trigger.trigger("click")
  await flushPromises()
  return new DOMWrapper(document.getElementById(trigger.attributes("aria-controls")!)!)
}

function visibleMessageIds(wrapper: VueWrapper): string[] {
  return wrapper.findAll<HTMLElement>("[data-super-message]").map(el => el.attributes("data-super-message")!)
}

function timelineOrder(wrapper: VueWrapper): string[] {
  const list = wrapper.get('ol[aria-label]')
  const out: string[] = []
  for (const child of Array.from(list.element.children)) {
    const seg = child.getAttribute("data-archived-segment")
    const msg = child.getAttribute("data-super-message")
    const fb = child.getAttribute("data-feedback-group-for")
    if (seg) out.push(`archived:${seg}`)
    else if (msg) out.push(`msg:${msg}`)
    else if (fb) out.push(`fb:${fb}`)
  }
  return out
}

afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount()
  if (pinia) {
    disposePinia(pinia)
    pinia = undefined
  }
  i18n.global.locale.value = originalLocale
  sessionStorage.clear()
  vi.restoreAllMocks()
})

test("archives a ticket into one compact line hiding all its messages (including final result, feedback, and quoted message), supports inline expand/collapse without restoring, and restores cleanly on explicit unarchive", async () => {
  const ticketA = makeTicket("ta", "登录鉴权修复", { accentSlot: 3, sessionId: "sess-a", workerContext: "directory" })
  const ticketB = makeTicket("tb", "支付回调重试", { accentSlot: 21, sessionId: "sess-b", workerContext: "directory" })
  const initial = makeRoom({
    tickets: [ticketA, ticketB],
    messageTicketLinks: {
      "a-u1": [ticketA.id],
      "a-s1": [ticketA.id],
      "a-w1": [ticketA.id],
      "a-u2": [ticketA.id],
      "a-w2": [ticketA.id],
      "b-u1": [ticketB.id],
      "b-s1": [ticketB.id],
    },
    messages: [
      makeMessage("a-u1", { role: "user", text: "排查刷新页面丢 token", state: "assigned", ticketId: ticketA.id }),
      makeMessage("a-d1", { role: "assistant", kind: "dispatch", text: ticketA.title, ticketId: ticketA.id, sourceMessageId: "a-u1" }),
      makeMessage("a-s1", { role: "assistant", text: "我先核对登录中间件。", ticketId: ticketA.id, sourceMessageId: "a-u1" }),
      makeMessage("a-w1", { role: "worker", workerEvent: "result", text: "定位到 refresh token 竞态。", ticketId: ticketA.id, sourceMessageId: "a-u1" }),
      makeMessage("a-u2", { role: "user", text: "请直接修复并补单测", state: "assigned", ticketId: ticketA.id }),
      makeMessage("a-d2", { role: "assistant", kind: "dispatch", text: ticketA.title, ticketId: ticketA.id, sourceMessageId: "a-u2" }),
      makeMessage("a-w2", { role: "worker", workerEvent: "result", text: "已修复登录鉴权并通过测试。", ticketId: ticketA.id, sourceMessageId: "a-u2" }),
      makeMessage("b-u1", { role: "user", text: "参考上面结论处理支付回调", replyTo: "a-w1", state: "assigned", ticketId: ticketB.id }),
      makeMessage("b-s1", { role: "assistant", text: "收到，开始排查支付回调。", ticketId: ticketB.id, sourceMessageId: "b-u1" }),
    ],
    feedback: {
      cursor: 1,
      previewGeneration: "gen-arch",
      processes: [],
      items: [
        { itemId: "ack-a1", kind: "ack", sourceMessageId: "a-u1", revision: 0, ticketId: ticketA.id, text: "已派工给执行 Agent 核对登录态", status: "completed", seq: 1, createdAt: "2026-11-28T06:00:00.000Z", updatedAt: "2026-11-28T06:00:00.000Z" },
      ],
    },
  })

  const { wrapper, api, getState } = await mountView(initial)
  expect(visibleMessageIds(wrapper)).toEqual(["a-u1", "a-s1", "a-w1", "a-u2", "a-w2", "b-u1", "b-s1"])
  expect(wrapper.find("[data-archived-segment]").exists()).toBe(false)

  // 1. Archive ticket A via Tickets popover -> confirm dialog
  let panel = await openTicketsPanel(wrapper)
  await panel.get(`button[aria-label="归档事项 · ${ticketA.title}"]`).trigger("click")
  await flushPromises()
  const doc = new DOMWrapper(document.body)
  await doc.get('[role="dialog"]').findAll("button").at(-1)!.trigger("click")
  await flushPromises()

  expect(api.archiveTicket).toHaveBeenCalledTimes(1)
  expect(api.archiveTicket).toHaveBeenLastCalledWith(expect.objectContaining({ ticketId: ticketA.id, archived: true }))
  // Underlying history is untouched
  expect(getState().messages).toHaveLength(initial.messages.length)

  // All 5 real conversation messages of A (excluding hidden dispatch markers) collapse into 1 compact line;
  // even final worker result a-w2, feedback ack-a1, and quoted a-w1 are hidden with NO display exception!
  const seg = wrapper.get(`[data-archived-segment="${ticketA.id}:a-u1"]`)
  expect(seg.attributes("data-archived-expanded")).toBe("false")
  expect(seg.attributes("data-sa-accent-slot")).toBe("3")
  const toggle = seg.get("[data-archived-segment-toggle]")
  expect(toggle.element.tagName).toBe("BUTTON")
  expect(toggle.attributes("aria-expanded")).toBe("false")
  expect(toggle.get("[data-archived-segment-badge]").text()).toBe("已归档")
  expect(toggle.get("[data-archived-ticket-name]").text()).toBe(ticketA.title)
  expect(toggle.get("[data-archived-ticket-name]").attributes("data-sa-accent-slot")).toBe("3")
  expect(toggle.get("[data-archived-segment-count]").text()).toBe("5 条消息")
  expect(toggle.get("[data-archived-segment-action]").text()).toBe("展开")

  expect(visibleMessageIds(wrapper)).toEqual(["b-u1", "b-s1"])
  expect(wrapper.find('[data-feedback-ack="ack-a1"]').exists()).toBe(false)
  expect(wrapper.find("[data-archived-segment-content]").exists()).toBe(false)

  // 2. Click quote on active B pointing to archived a-w1 -> expands segment inline & locates a-w1 WITHOUT unarchiving!
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {})
  await wrapper.get('[data-super-message="b-u1"] [data-reply-quote="a-w1"] [data-reply-quote-target]').trigger("click")
  await flushPromises()
  expect(seg.attributes("data-archived-expanded")).toBe("true")
  expect(toggle.attributes("aria-expanded")).toBe("true")
  expect(toggle.get("[data-archived-segment-action]").text()).toBe("收起")
  expect(wrapper.get('[data-super-message="a-w1"]').attributes("data-conversation-located")).toBe("true")
  expect(scroll.mock.contexts).toContain(wrapper.get('[data-super-message="a-w1"]').element)
  expect(api.archiveTicket).toHaveBeenCalledTimes(1)
  expect(getState().tickets.find(t => t.id === ticketA.id)?.archiveState).toBe("archived")

  // 3. Collapse again inline
  await toggle.trigger("click")
  await flushPromises()
  expect(seg.attributes("data-archived-expanded")).toBe("false")
  expect(toggle.attributes("aria-expanded")).toBe("false")
  expect(toggle.get("[data-archived-segment-action]").text()).toBe("展开")
  expect(visibleMessageIds(wrapper)).toEqual(["b-u1", "b-s1"])

  // 4. Expand inline again -> reading does NOT restore ticket A
  await toggle.trigger("click")
  await flushPromises()
  expect(seg.attributes("data-archived-expanded")).toBe("true")
  expect(visibleMessageIds(wrapper)).toEqual(["a-u1", "a-s1", "a-w1", "a-u2", "a-w2", "b-u1", "b-s1"])
  expect(wrapper.get('[data-feedback-ack="ack-a1"]').text()).toContain("已派工给执行 Agent")
  expect(api.archiveTicket).toHaveBeenCalledTimes(1)
  expect(wrapper.get("[data-tickets-menu]").text()).toBe("事项（1）")

  // 5. Explicitly unarchive (restore) ticket A -> returns to default expanded timeline
  panel = await openTicketsPanel(wrapper)
  const archivedGroup = panel.findAll("details").find(d => d.get("summary").text().includes("已归档"))!
  await archivedGroup.get("summary").trigger("click")
  const restoreDetails = archivedGroup.get("details")
  await restoreDetails.get("summary").trigger("click")
  await restoreDetails.findAll("button").find(b => b.text() === "恢复事项")!.trigger("click")
  await flushPromises()
  await doc.get('[role="dialog"]').findAll("button").at(-1)!.trigger("click")
  await flushPromises()

  expect(api.archiveTicket).toHaveBeenCalledTimes(2)
  expect(api.archiveTicket).toHaveBeenLastCalledWith(expect.objectContaining({ ticketId: ticketA.id, archived: false }))
  expect(wrapper.find("[data-archived-segment]").exists()).toBe(false)
  expect(visibleMessageIds(wrapper)).toEqual(["a-u1", "a-s1", "a-w1", "a-u2", "a-w2", "b-u1", "b-s1"])

  // 6. Re-archiving ticket A starts collapsed by default again (stale expand ID pruned on restore)
  panel = await openTicketsPanel(wrapper)
  await panel.get(`button[aria-label="归档事项 · ${ticketA.title}"]`).trigger("click")
  await flushPromises()
  await doc.get('[role="dialog"]').findAll("button").at(-1)!.trigger("click")
  await flushPromises()
  expect(wrapper.get(`[data-archived-segment="${ticketA.id}:a-u1"]`).attributes("data-archived-expanded")).toBe("false")
  expect(visibleMessageIds(wrapper)).toEqual(["b-u1", "b-s1"])
})

test("splits archived runs strictly by actual association: preserves interleaved unassociated, active, and distinct archived tickets in place without adjacency guessing", async () => {
  const ticketA = makeTicket("ta", "日志清理", { accentSlot: 4, archiveState: "archived" })
  const ticketB = makeTicket("tb", "正在进行的需求", { accentSlot: 18 })
  const ticketC = makeTicket("tc", "旧版接口下线", { accentSlot: 31, archiveState: "archived" })
  const ticketD = makeTicket("td", "正在归档中", { accentSlot: 12, archiveState: "archiving" })

  const { wrapper } = await mountView(makeRoom({
    tickets: [ticketA, ticketB, ticketC, ticketD],
    messageTicketLinks: {
      "a1": [ticketA.id],
      "a2": [ticketA.id],
      "b1": [ticketB.id],
      "a3": [ticketA.id],
      "c1": [ticketC.id],
      "c2": [ticketC.id],
      "a4": [ticketA.id],
      "d1": [ticketD.id],
    },
    messages: [
      makeMessage("a1", { role: "user", text: "A 第1条", ticketId: ticketA.id }),
      makeMessage("a2", { role: "assistant", text: "A 第2条", sourceMessageId: "a1", ticketId: ticketA.id }),
      makeMessage("plain-mid", { role: "user", text: "中间穿插的未归属闲聊" }),
      makeMessage("b1", { role: "user", text: "活跃事项 B 消息", ticketId: ticketB.id }),
      makeMessage("a3", { role: "worker", workerEvent: "result", text: "A 第3条", ticketId: ticketA.id }),
      makeMessage("c1", { role: "user", text: "C 第1条", ticketId: ticketC.id }),
      makeMessage("c2", { role: "assistant", text: "C 第2条", sourceMessageId: "c1", ticketId: ticketC.id }),
      makeMessage("a4", { role: "user", text: "A 第4条", ticketId: ticketA.id }),
      makeMessage("d1", { role: "user", text: "归档中的 D 暂不折叠", ticketId: ticketD.id }),
    ],
  }))

  // Exact timeline order: [A seg1(2)] -> plain-mid -> b1 -> [A seg2(1)] -> [C seg1(2)] -> [A seg3(1)] -> d1
  expect(timelineOrder(wrapper)).toEqual([
    "archived:ta:a1",
    "msg:plain-mid",
    "msg:b1",
    "archived:ta:a3",
    "archived:tc:c1",
    "archived:ta:a4",
    "msg:d1",
  ])
  expect(visibleMessageIds(wrapper)).toEqual(["plain-mid", "b1", "d1"])

  const segA1 = wrapper.get('[data-archived-segment="ta:a1"]')
  const segA2 = wrapper.get('[data-archived-segment="ta:a3"]')
  const segC1 = wrapper.get('[data-archived-segment="tc:c1"]')
  const segA3 = wrapper.get('[data-archived-segment="ta:a4"]')
  expect(segA1.get("[data-archived-segment-count]").text()).toBe("2 条消息")
  expect(segA2.get("[data-archived-segment-count]").text()).toBe("1 条消息")
  expect(segC1.get("[data-archived-segment-count]").text()).toBe("2 条消息")
  expect(segC1.attributes("data-sa-accent-slot")).toBe("31")
  expect(segA3.get("[data-archived-segment-count]").text()).toBe("1 条消息")

  // Expanding segment 1 of A only expands segment 1, leaving segment 2, segment 3, and C collapsed!
  await segA1.get("[data-archived-segment-toggle]").trigger("click")
  await flushPromises()
  expect(segA1.attributes("data-archived-expanded")).toBe("true")
  expect(segA2.attributes("data-archived-expanded")).toBe("false")
  expect(segC1.attributes("data-archived-expanded")).toBe("false")
  expect(segA3.attributes("data-archived-expanded")).toBe("false")
  expect(visibleMessageIds(wrapper)).toEqual(["a1", "a2", "plain-mid", "b1", "d1"])
})

test("handles multi-ticket shared messages safely: keeps visible while any linked ticket is active, folds together only when all linked tickets are archived", async () => {
  const ticketA = makeTicket("ta", "前端方案", { accentSlot: 2, archiveState: "archived" })
  const ticketB = makeTicket("tb", "后端方案", { accentSlot: 21 })

  // Case 1: A archived, B active -> shared [A, B] stays expanded and splits A's runs
  const first = await mountView(makeRoom({
    tickets: [ticketA, ticketB],
    messageTicketLinks: {
      "a-only-1": [ticketA.id],
      "shared-1": [ticketA.id, ticketB.id],
      "a-only-2": [ticketA.id],
    },
    messages: [
      makeMessage("a-only-1", { text: "仅 A 1", ticketIds: [ticketA.id] }),
      makeMessage("shared-1", { text: "A 与 B 共用讨论", ticketIds: [ticketA.id, ticketB.id] }),
      makeMessage("a-only-2", { text: "仅 A 2", ticketIds: [ticketA.id] }),
    ],
  }))
  expect(timelineOrder(first.wrapper)).toEqual([
    "archived:ta:a-only-1",
    "msg:shared-1",
    "archived:ta:a-only-2",
  ])
  expect(visibleMessageIds(first.wrapper)).toEqual(["shared-1"])

  // Case 2: Both A and B archived -> shared [A, B] and [B, A] merge into a shared archived segment distinct from single-ticket A/B runs
  const ticketBArchived = { ...ticketB, archiveState: "archived" as const }
  const second = await mountView(makeRoom({
    tickets: [ticketA, ticketBArchived],
    messageTicketLinks: {
      "a-only": [ticketA.id],
      "shared-q": [ticketA.id, ticketBArchived.id],
      "shared-a": [ticketBArchived.id, ticketA.id],
      "b-only": [ticketBArchived.id],
    },
    messages: [
      makeMessage("a-only", { text: "仅 A", ticketIds: [ticketA.id] }),
      makeMessage("shared-q", { text: "共用问", ticketIds: [ticketA.id, ticketBArchived.id] }),
      makeMessage("shared-a", { role: "assistant", text: "共用答", sourceMessageId: "shared-q", ticketIds: [ticketBArchived.id, ticketA.id] }),
      makeMessage("b-only", { text: "仅 B", ticketIds: [ticketBArchived.id] }),
    ],
  }))
  const segments = second.wrapper.findAll("[data-archived-segment]")
  expect(segments).toHaveLength(3)
  expect(segments[0]!.attributes("data-archived-ticket-ids")).toBe("ta")
  expect(segments[1]!.attributes("data-archived-ticket-ids")).toBe("ta,tb")
  expect(segments[1]!.get("[data-archived-segment-count]").text()).toBe("2 条消息")
  expect(segments[1]!.findAll("[data-archived-ticket-name]").map(el => [
    el.attributes("data-sa-ticket-id"),
    el.attributes("data-sa-accent-slot"),
    el.text(),
  ])).toEqual([
    ["ta", "2", "前端方案"],
    ["tb", "21", "后端方案"],
  ])
  expect(segments[2]!.attributes("data-archived-ticket-ids")).toBe("tb")
  expect(visibleMessageIds(second.wrapper)).toEqual([])
})

test("hides nested approval groups and folded stopped turns inside a collapsed archived segment, and preserves them on expand", async () => {
  const ticketA = makeTicket("ta", "权限与重编辑历史", { accentSlot: 7, archiveState: "archived", status: "stopped" })
  const initial = makeRoom({
    tickets: [ticketA],
    messageTicketLinks: {
      "u-old": [ticketA.id],
      "u-new": [ticketA.id],
      "p1": [ticketA.id],
      "p2": [ticketA.id],
      "w-res": [ticketA.id],
    },
    messages: [
      makeMessage("u-old", { text: "错误指令", state: "stopped", ticketId: ticketA.id }),
      makeMessage("u-new", { text: "修正后指令", reEditOf: "u-old", state: "assigned", ticketId: ticketA.id }),
      makeMessage("p1", { role: "worker", workerEvent: "permission", turnId: "t1", ticketId: ticketA.id, text: "Permission requested\nnpm test" }),
      makeMessage("p2", { role: "worker", workerEvent: "permission", turnId: "t1", ticketId: ticketA.id, text: "Permission requested\nnpm build" }),
      makeMessage("w-res", { role: "worker", workerEvent: "result", turnId: "t1", sourceMessageId: "u-new", ticketId: ticketA.id, text: "全部完成" }),
    ],
  })

  const { wrapper } = await mountView(initial)
  // Collapsed: nothing leaks outside the single archived bar!
  expect(wrapper.findAll("[data-archived-segment]")).toHaveLength(1)
  expect(wrapper.find("[data-folded-stopped-turn]").exists()).toBe(false)
  expect(wrapper.find("[data-approval-history]").exists()).toBe(false)
  expect(visibleMessageIds(wrapper)).toEqual([])
  expect(wrapper.get("[data-archived-segment-count]").text()).toBe("5 条消息")

  // Expanded: inner folded stopped turn and collapsed approval group stay intact!
  await wrapper.get("[data-archived-segment-toggle]").trigger("click")
  await flushPromises()
  expect(wrapper.find('[data-folded-stopped-turn="u-old"]').exists()).toBe(true)
  expect(wrapper.find('[data-approval-history="p1"]').exists()).toBe(true)
  expect(visibleMessageIds(wrapper)).toEqual(["u-new", "w-res"])
})

test("focusing an archived ticket shows its chain directly without unarchiving, and sending a new message never passes fold state or filters history", async () => {
  const ticketA = makeTicket("ta", "已归档旧事项", { accentSlot: 9, archiveState: "archived" })
  const initial = makeRoom({
    tickets: [ticketA],
    messageTicketLinks: { "a-1": [ticketA.id], "a-2": [ticketA.id] },
    messages: [
      makeMessage("a-1", { text: "旧问题", ticketId: ticketA.id }),
      makeMessage("a-2", { role: "assistant", text: "旧回答", sourceMessageId: "a-1", ticketId: ticketA.id }),
    ],
  })

  const { wrapper, api, getState } = await mountView(initial)
  expect(visibleMessageIds(wrapper)).toEqual([])

  // Enter Focus on archived A -> visible directly, still archived
  const panel = await openTicketsPanel(wrapper)
  const archivedDetails = panel.get("details")
  await archivedDetails.get("summary").trigger("click")
  await archivedDetails.get(`[data-ticket-focus-id="${ticketA.id}"]`).trigger("click")
  await flushPromises()
  expect(visibleMessageIds(wrapper)).toEqual(["a-1", "a-2"])
  expect(api.archiveTicket).not.toHaveBeenCalled()

  // Exit focus -> returns to folded state
  await wrapper.get("[data-ticket-focus-exit]").trigger("click")
  await flushPromises()
  expect(visibleMessageIds(wrapper)).toEqual([])
  expect(wrapper.get('[data-archived-segment="ta:a-1"]').attributes("data-archived-expanded")).toBe("false")

  // Send new message while A is folded -> payload has no fold flags and full history remains intact
  const textarea = wrapper.get<HTMLTextAreaElement>("[data-composer-input]")
  await textarea.setValue("新开一个话题")
  await wrapper.get(".composer-send").trigger("click")
  await flushPromises()
  expect(api.send).toHaveBeenCalledTimes(1)
  const payload = (api.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
  expect(payload).toMatchObject({ workspaceId: "ws-archive-fold", text: "新开一个话题" })
  expect(Object.keys(payload).some(k => /fold|archiv|collaps/i.test(k))).toBe(false)
  expect(getState().messages.map(m => m.id)).toContain("a-1")
  expect(getState().messages.map(m => m.id)).toContain("a-2")
})

test("supports en-US singular/plural, ja-JP, untitled fallback, touch min-h-11, and WCAG AA contrast across all 48 light/dark ticket accent mixes", async () => {
  // Check en-US singular & plural + untitled fallback + mobile touch target
  const tOne = makeTicket("t1", "", { accentSlot: 15, archiveState: "archived" })
  const tTwo = makeTicket("t2", "Release checklist", { accentSlot: 28, archiveState: "archived" })
  const enView = await mountView(
    makeRoom({
      tickets: [tOne, tTwo],
      messageTicketLinks: { "m1": [tOne.id], "m2": [tTwo.id], "m3": [tTwo.id] },
      messages: [
        makeMessage("m1", { text: "one", ticketId: tOne.id }),
        makeMessage("m2", { text: "two", ticketId: tTwo.id }),
        makeMessage("m3", { role: "assistant", text: "three", sourceMessageId: "m2", ticketId: tTwo.id }),
      ],
    }),
    { locale: "en-US", mobile: true },
  )
  const seg1 = enView.wrapper.get('[data-archived-segment="t1:m1"]')
  const seg2 = enView.wrapper.get('[data-archived-segment="t2:m2"]')
  expect(seg1.get("[data-archived-segment-badge]").text()).toBe("Archived")
  expect(seg1.get("[data-archived-ticket-name]").text()).toBe("Untitled ticket")
  expect(seg1.get("[data-archived-segment-count]").text()).toBe("1 message")
  expect(seg1.get("[data-archived-segment-action]").text()).toBe("Expand")
  expect(seg1.get("[data-archived-segment-toggle]").classes()).toContain("min-h-11")
  expect(seg2.get("[data-archived-segment-count]").text()).toBe("2 messages")

  // Check ja-JP
  const jaView = await mountView(
    makeRoom({
      tickets: [tTwo],
      messageTicketLinks: { "m2": [tTwo.id] },
      messages: [makeMessage("m2", { text: "two", ticketId: tTwo.id })],
    }),
    { locale: "ja-JP" },
  )
  const jaSeg = jaView.wrapper.get('[data-archived-segment="t2:m2"]')
  expect(jaSeg.get("[data-archived-segment-badge]").text()).toBe("アーカイブ済み")
  expect(jaSeg.get("[data-archived-segment-count]").text()).toBe("1 件のメッセージ")
  expect(jaSeg.get("[data-archived-segment-action]").text()).toBe("展開")

  // Check CSS compliance: transparent borderless bar with neutral gray chrome (only ticket name tinted),
  // no container opacity on archived segment/content, link underlines & crisp focus rings preserved,
  // and WCAG AA contrast (>= 4.5:1) across body, metadata, links, and all 48 light/dark ticket name mixes.
  const sfcPath = resolve(import.meta.dirname, "../components/session/WorkspaceArchivedSegment.vue")
  const sfc = readFileSync(sfcPath, "utf8")
  expect(sfc).toContain("color-mix(in oklab,")
  expect(sfc).not.toContain("in oklch")
  expect(sfc).toContain(":focus-visible")
  expect(sfc).toContain("@media (pointer: coarse)")
  expect(sfc).toContain("@media (forced-colors: active)")
  const segmentRule = /\.sa-archived-segment\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const barRule = /\.sa-archived-bar\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const expandedRule = /\.sa-archived-bar\.sa-archived-bar-expanded\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const hoverRule = /\.sa-archived-bar:hover\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const chevronRule = /\.sa-archived-chevron\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const actionRule = /\.sa-archived-action\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const contentRule = /\.sa-archived-content\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  const linkRule = /\.sa-archived-content\s*:deep\(a\)\s*\{([^}]*)\}/u.exec(sfc)?.[1] ?? ""
  expect(barRule).toContain("background-color: transparent;")
  expect(barRule).toContain("border: 0;")
  expect(expandedRule).toContain("background-color: transparent;")
  expect(expandedRule).toContain("border: 0;")
  expect(hoverRule).toContain("background-color: transparent;")
  expect(hoverRule).not.toContain("border-color:")
  expect(chevronRule).toContain("color: var(--ui-color-text-muted);")
  expect(chevronRule).not.toContain("--sa-accent-text")
  expect(actionRule).toContain("color: var(--ui-color-text-muted);")
  expect(actionRule).not.toContain("--sa-accent-text")
  expect(segmentRule).not.toContain("opacity:")
  expect(contentRule).not.toContain("opacity:")
  expect(sfc).not.toMatch(/\.sa-archived-content:hover/u)
  expect(linkRule).toContain("text-decoration: underline;")
  expect(sfc).not.toMatch(/background-color:\s*color-mix\(/u)

  const LIGHT_CANVAS = "#fbfbfd"
  const LIGHT_TEXT = "#1b1f2b"
  const LIGHT_MUTED = "#596173"
  const LIGHT_ACCENT = "#4a5bd4"
  const DARK_CANVAS = "#17191f"
  const DARK_TEXT = "#e7e9ef"
  const DARK_MUTED = "#a3a9b7"
  const DARK_ACCENT = "#8e9bff"

  // Verify visual hierarchy & WCAG AA contrast in both light and dark themes:
  // active body > archived body (>= 4.5:1) > archived meta (>= 4.5:1), and archived links >= 4.5:1.
  const lightArchBody = mixOklabHex(LIGHT_TEXT, 0.74, LIGHT_CANVAS, 0.26)
  const lightArchMeta = mixOklabHex(LIGHT_MUTED, 0.88, LIGHT_CANVAS, 0.12)
  const lightArchLink = mixOklabHex(LIGHT_ACCENT, 0.56, LIGHT_MUTED, 0.44)
  expect(wcagContrastRatio(lightArchBody, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
  expect(wcagContrastRatio(lightArchBody, LIGHT_CANVAS)).toBeLessThan(wcagContrastRatio(LIGHT_TEXT, LIGHT_CANVAS))
  expect(wcagContrastRatio(lightArchMeta, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
  expect(wcagContrastRatio(lightArchMeta, LIGHT_CANVAS)).toBeLessThan(wcagContrastRatio(lightArchBody, LIGHT_CANVAS))
  expect(wcagContrastRatio(lightArchLink, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)

  const darkArchBody = mixOklabHex(DARK_TEXT, 0.74, DARK_CANVAS, 0.26)
  const darkArchMeta = mixOklabHex(DARK_MUTED, 0.88, DARK_CANVAS, 0.12)
  const darkArchLink = mixOklabHex(DARK_ACCENT, 0.56, DARK_MUTED, 0.44)
  expect(wcagContrastRatio(darkArchBody, DARK_CANVAS)).toBeGreaterThanOrEqual(4.5)
  expect(wcagContrastRatio(darkArchBody, DARK_CANVAS)).toBeLessThan(wcagContrastRatio(DARK_TEXT, DARK_CANVAS))
  expect(wcagContrastRatio(darkArchMeta, DARK_CANVAS)).toBeGreaterThanOrEqual(4.5)
  expect(wcagContrastRatio(darkArchMeta, DARK_CANVAS)).toBeLessThan(wcagContrastRatio(darkArchBody, DARK_CANVAS))
  expect(wcagContrastRatio(darkArchLink, DARK_CANVAS)).toBeGreaterThanOrEqual(4.5)

  for (let slot = 0; slot < SA_ACCENT_SLOT_COUNT; slot++) {
    const entry = SA_ACCENT_PALETTE[slot]!
    const lightMixed = mixOklabHex(LIGHT_MUTED, 0.72, entry.light.labelText, 0.28)
    const darkMixed = mixOklabHex(DARK_MUTED, 0.72, entry.dark.labelText, 0.28)
    expect(wcagContrastRatio(lightMixed, LIGHT_CANVAS), `light slot ${slot}`).toBeGreaterThanOrEqual(4.5)
    expect(wcagContrastRatio(darkMixed, DARK_CANVAS), `dark slot ${slot}`).toBeGreaterThanOrEqual(4.5)
  }

  // Verify buildWorkspaceTranscript pure helper foldArchived toggle preserves exact row count without filtering
  const ticketMap = new Map([[tTwo.id, tTwo]])
  const rows = workspaceMessageRows([makeMessage("m2", { ticketId: tTwo.id })], ticketMap)
  expect(buildWorkspaceTranscript(rows, new Map(), new Set(), { foldArchived: true })[0]?.kind).toBe("archivedSegment")
  expect(buildWorkspaceTranscript(rows, new Map(), new Set(), { foldArchived: false })[0]?.kind).toBe("group")
})
