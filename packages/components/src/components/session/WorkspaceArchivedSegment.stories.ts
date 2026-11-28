import type { SuperAgentApi } from "@deskfleet/client/desktop-api"
import type { SuperMessage, SuperSnapshot, SuperTicket } from "@deskfleet/protocol/super-agent"
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { ref } from "vue"
import WorkspaceAgentView from "../../views/WorkspaceAgentView.vue"
import WorkspaceArchivedSegment from "./WorkspaceArchivedSegment.vue"

const ticketAuth: SuperTicket = {
  id: "ticket-auth",
  title: "登录鉴权修复",
  scope: "修复刷新页面丢失 token 的问题",
  summary: "已完成修复并验证",
  provider: "codex",
  sessionId: "sess-auth",
  workerContext: "directory",
  accentSlot: 3,
  archiveState: "archived",
  updatedAt: "2026-11-28T06:00:00.000Z",
}

const ticketActive: SuperTicket = {
  id: "ticket-active",
  title: "首页性能优化",
  scope: "减少首屏渲染阻塞",
  summary: "正在执行中",
  provider: "codex",
  sessionId: "sess-active",
  workerContext: "directory",
  accentSlot: 21,
  updatedAt: "2026-11-28T06:10:00.000Z",
}

const ticketPay: SuperTicket = {
  id: "ticket-pay",
  title: "支付回调幂等重试与超长事项名称窄窗口省略表现验证",
  scope: "支付回调幂等重试",
  summary: "已归档",
  provider: "codex",
  sessionId: "sess-pay",
  workerContext: "directory",
  accentSlot: 31,
  archiveState: "archived",
  updatedAt: "2026-11-28T06:05:00.000Z",
}

const ticketSharedA: SuperTicket = {
  id: "ticket-fe",
  title: "前端方案",
  scope: "前端方案",
  summary: "",
  provider: "codex",
  accentSlot: 33,
  archiveState: "archived",
  updatedAt: "2026-11-28T06:00:00.000Z",
}

function makeInteractiveApi(): SuperAgentApi {
  let state: SuperSnapshot = {
    workspaceId: "ws-story-archive",
    provider: "codex",
    supportsTicketArchive: true,
    supportsTicketLinks: true,
    supportsStop: true,
    supportsReplyFeedback: true,
    tickets: [
      { ...ticketAuth },
      { ...ticketActive },
      { ...ticketPay },
    ],
    messageTicketLinks: {
      "auth-1": [ticketAuth.id],
      "auth-2": [ticketAuth.id],
      "auth-3": [ticketAuth.id],
      "active-1": [ticketActive.id],
      "active-2": [ticketActive.id],
      "auth-4": [ticketAuth.id],
      "auth-5": [ticketAuth.id],
      "pay-1": [ticketPay.id],
      "pay-2": [ticketPay.id],
    },
    messages: [
      { id: "auth-1", role: "user", text: "排查刷新页面后偶发丢失登录态的问题", createdAt: "2026-11-28T05:00:00.000Z", state: "assigned", ticketId: ticketAuth.id },
      { id: "auth-2", role: "assistant", text: "我先排查 refresh token 的并发刷新逻辑。", sourceMessageId: "auth-1", createdAt: "2026-11-28T05:00:10.000Z", ticketId: ticketAuth.id },
      { id: "auth-3", role: "worker", workerEvent: "result", text: "已定位并发刷新竞态并补充单飞锁，测试全部通过。", sourceMessageId: "auth-1", createdAt: "2026-11-28T05:05:00.000Z", ticketId: ticketAuth.id },
      { id: "plain-1", role: "user", text: "顺便确认一下，今天下午发版窗口是 16:00 吗？", createdAt: "2026-11-28T05:10:00.000Z", state: "answered" },
      { id: "plain-2", role: "assistant", text: "是的，16:00 开始灰度发布。", sourceMessageId: "plain-1", createdAt: "2026-11-28T05:10:08.000Z" },
      { id: "active-1", role: "user", text: "开始排查首页首屏渲染耗时，重点看字体和图表加载。", createdAt: "2026-11-28T05:20:00.000Z", state: "assigned", ticketId: ticketActive.id },
      { id: "active-2", role: "assistant", text: "收到，已派发执行 Agent 分析首页加载链路。", sourceMessageId: "active-1", createdAt: "2026-11-28T05:20:10.000Z", ticketId: ticketActive.id },
      { id: "auth-4", role: "user", text: "补充验证 Safari 隐身模式下刷新是否正常。", createdAt: "2026-11-28T05:25:00.000Z", state: "assigned", ticketId: ticketAuth.id },
      { id: "auth-5", role: "worker", workerEvent: "result", text: "Safari 隐身模式回归通过。", sourceMessageId: "auth-4", createdAt: "2026-11-28T05:28:00.000Z", ticketId: ticketAuth.id },
      { id: "pay-1", role: "user", text: "把支付回调重复通知的幂等校验补齐。", createdAt: "2026-11-28T05:30:00.000Z", state: "assigned", ticketId: ticketPay.id },
      { id: "pay-2", role: "worker", workerEvent: "result", text: "已加上基于回调单号的幂等去重并验证。", sourceMessageId: "pay-1", createdAt: "2026-11-28T05:36:00.000Z", ticketId: ticketPay.id },
    ] satisfies SuperMessage[],
  }
  return {
    snapshot: async () => state,
    stop: async () => state,
    archiveTicket: async ({ ticketId, archived }) => {
      state = {
        ...state,
        tickets: state.tickets.map(item =>
          item.id === ticketId ? { ...item, archiveState: archived ? "archived" : undefined } : item,
        ),
      }
      return state
    },
    send: async request => {
      state = {
        ...state,
        messages: [...state.messages, { id: request.messageId, role: "user", text: request.text, createdAt: new Date().toISOString(), state: "answered" }],
      }
      return state
    },
    correct: async () => state,
    settings: async () => state,
  }
}

const meta = {
  title: "Domain/Agent Session/WorkspaceArchivedSegment",
  component: WorkspaceArchivedSegment,
  tags: ["autodocs"],
  args: {
    segmentId: "ticket-auth:m1",
    tickets: [ticketAuth],
    messageCount: 8,
    expanded: false,
    touch: false,
  },
  render: args => ({
    components: { WorkspaceArchivedSegment },
    setup() {
      const open = ref(args.expanded)
      return { args, open }
    },
    template: `
      <ol class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 text-[15px] leading-[1.65]">
        <li class="text-sm text-ui-text">前面的未归档消息保持原位展示。</li>
        <WorkspaceArchivedSegment
          v-bind="args"
          :expanded="open"
          @toggle="open = !open"
        >
          <li class="text-sm text-ui-text">用户：排查刷新丢 token 的原因。</li>
          <li class="text-sm text-ui-text-muted">Super Agent：已定位到 refresh token 竞态并完成修复。</li>
        </WorkspaceArchivedSegment>
        <li class="text-sm text-ui-text">后面的未归档消息保持原位展示。</li>
      </ol>
    `,
  }),
} satisfies Meta<typeof WorkspaceArchivedSegment>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const Expanded: Story = {
  args: {
    expanded: true,
  },
}

export const NarrowWindow: Story = {
  args: {
    segmentId: "ticket-pay:m2",
    tickets: [ticketPay],
    messageCount: 12,
    expanded: false,
  },
  decorators: [
    () => ({
      template: '<div class="mx-auto w-[340px] max-w-full border border-dashed border-ui-border/50"><story /></div>',
    }),
  ],
}

export const MultiTicketArchived: Story = {
  args: {
    segmentId: "shared:m3",
    tickets: [ticketSharedA, ticketPay],
    messageCount: 4,
    expanded: false,
  },
}

function makeComparisonApi(): SuperAgentApi {
  const sampleUserText = "排查刷新页面后偶发丢失登录态的问题，并核对单飞刷新锁是否覆盖并发请求。"
  const sampleAssistantText =
    "已核对登录态中间件与 [`refresh-token.ts`](https://example.com/docs/refresh-token)：在 `singleFlightRefresh()` 复用同一刷新 Promise，避免并发请求互相覆盖新令牌。"
  const activeSample: SuperTicket = {
    id: "cmp-active",
    title: "登录鉴权修复（未归档）",
    scope: "未归档对照样本",
    summary: "处理中",
    provider: "codex",
    sessionId: "sess-cmp-active",
    workerContext: "directory",
    accentSlot: 3,
    updatedAt: "2026-11-28T06:10:00.000Z",
  }
  const archivedSample: SuperTicket = {
    id: "cmp-archived",
    title: "登录鉴权修复（已归档）",
    scope: "已归档对照样本",
    summary: "已完成",
    provider: "codex",
    sessionId: "sess-cmp-archived",
    workerContext: "directory",
    accentSlot: 3,
    archiveState: "archived",
    updatedAt: "2026-11-28T06:00:00.000Z",
  }
  const collapsedSample: SuperTicket = {
    id: "cmp-collapsed",
    title: "支付回调幂等重试",
    scope: "已归档默认折叠对照",
    summary: "已完成",
    provider: "codex",
    sessionId: "sess-cmp-collapsed",
    workerContext: "directory",
    accentSlot: 21,
    archiveState: "archived",
    updatedAt: "2026-11-28T05:50:00.000Z",
  }
  let state: SuperSnapshot = {
    workspaceId: "ws-story-compare",
    provider: "codex",
    supportsTicketArchive: true,
    supportsTicketLinks: true,
    supportsStop: true,
    supportsReplyFeedback: true,
    tickets: [activeSample, archivedSample, collapsedSample],
    messageTicketLinks: {
      "cmp-active-u": [activeSample.id],
      "cmp-active-a": [activeSample.id],
      "cmp-arch-u": [archivedSample.id],
      "cmp-arch-a": [archivedSample.id],
      "cmp-col-u": [collapsedSample.id],
      "cmp-col-a": [collapsedSample.id],
    },
    messages: [
      { id: "cmp-active-u", role: "user", text: sampleUserText, createdAt: "2026-11-28T06:00:00.000Z", state: "assigned", ticketId: activeSample.id },
      { id: "cmp-active-a", role: "assistant", text: sampleAssistantText, sourceMessageId: "cmp-active-u", createdAt: "2026-11-28T06:00:12.000Z", ticketId: activeSample.id },
      { id: "cmp-arch-u", role: "user", text: sampleUserText, createdAt: "2026-11-28T06:05:00.000Z", state: "assigned", ticketId: archivedSample.id },
      { id: "cmp-arch-a", role: "assistant", text: sampleAssistantText, sourceMessageId: "cmp-arch-u", createdAt: "2026-11-28T06:05:12.000Z", ticketId: archivedSample.id },
      { id: "cmp-col-u", role: "user", text: "补齐支付回调去重校验", createdAt: "2026-11-28T06:08:00.000Z", state: "assigned", ticketId: collapsedSample.id },
      { id: "cmp-col-a", role: "assistant", text: "已完成幂等校验并回归通过。", sourceMessageId: "cmp-col-u", createdAt: "2026-11-28T06:08:10.000Z", ticketId: collapsedSample.id },
    ] satisfies SuperMessage[],
  }
  return {
    snapshot: async () => state,
    stop: async () => state,
    archiveTicket: async ({ ticketId, archived }) => {
      state = {
        ...state,
        tickets: state.tickets.map(item =>
          item.id === ticketId ? { ...item, archiveState: archived ? "archived" : undefined } : item,
        ),
      }
      return state
    },
    send: async request => {
      state = {
        ...state,
        messages: [...state.messages, { id: request.messageId, role: "user", text: request.text, createdAt: new Date().toISOString(), state: "answered" }],
      }
      return state
    },
    correct: async () => state,
    settings: async () => state,
  }
}

export const ActiveVsArchivedComparison: Story = {
  render: () => ({
    components: { WorkspaceAgentView },
    setup() {
      const api = makeComparisonApi()
      return { api }
    },
    template: `
      <div class="flex h-[840px] w-full flex-col bg-ui-canvas text-ui-text">
        <WorkspaceAgentView :api="api" workspace-id="ws-story-compare" />
      </div>
    `,
  }),
}

export const FullTimelineInteractive: Story = {
  render: () => ({
    components: { WorkspaceAgentView },
    setup() {
      const api = makeInteractiveApi()
      return { api }
    },
    template: `
      <div class="flex h-[760px] w-full flex-col bg-ui-canvas text-ui-text">
        <WorkspaceAgentView :api="api" workspace-id="ws-story-archive" />
      </div>
    `,
  }),
}
