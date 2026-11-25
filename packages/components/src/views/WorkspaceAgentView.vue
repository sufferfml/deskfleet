<script setup lang="ts">
import { Archive, ArrowDown, ArrowRight, CalendarClock, ChevronDown, ChevronRight, ClipboardList, CornerUpLeft, Folder, MapPin, MessagesSquare, X } from "@lucide/vue"
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui"
import { useOnline, useResizeObserver, useTimeoutFn } from "@vueuse/core"
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue"
import { useI18n } from "vue-i18n"
import { RouterLink, useRouter } from "vue-router"
import type { GithubRepositoryItem } from "@deskfleet/client/central"
import type { DeskfleetDesktopApi } from "@deskfleet/client/desktop-api"
import type { FollowUpRunRecord, FollowUpSourcesResponse, SuperFeedbackItem, SuperMessage, SuperTicket, SuperWorkerRequest, SuperWorkspaceId } from "@deskfleet/protocol/super-agent"
import { disableTakeoverOnMachine, enableTakeoverOnMachine } from "../services/workspace-agent-follow-up.ts"
import ConfirmDialog from "../components/common/ConfirmDialog.vue"
import GithubIcon from "../components/common/GithubIcon.vue"
import GithubPanel from "../components/details/GithubPanel.vue"
import { withGithubReference } from "../services/github-composer-reference.ts"
import PaneHeader from "../components/chrome/PaneHeader.vue"
import SpringSurface from "../components/common/SpringSurface.ts"
import UiScrollArea from "../components/common/UiScrollArea.vue"
import AgentContent from "../components/session/AgentContent.vue"
import AgentMessageActions from "../components/session/AgentMessageActions.vue"
import AgentOutline from "../components/session/AgentOutline.vue"
import ReadingSpotlight from "../components/session/ReadingSpotlight.vue"
import { scrollSpring, type SpringScroll } from "../services/spring-scroll.ts"
import { useConversationReadingStore } from "../stores/conversation-reading.ts"
import UiButton from "../components/common/UiButton.vue"
import UiDialog from "../components/common/UiDialog.vue"
import ProjectModelMenu from "../components/composer/ProjectModelMenu.vue"
import SessionComposer from "../components/composer/SessionComposer.vue"
import WorkspaceProgressDetails from "../components/session/WorkspaceProgressDetails.vue"
import WorkspaceReplyProgress from "../components/session/WorkspaceReplyProgress.vue"
import WorkspaceWorkerRequest from "../components/session/WorkspaceWorkerRequest.vue"
import WorkspaceMessage from "../components/session/WorkspaceMessage.vue"
import { useFileTarget, useTranscriptFileTarget } from "../composables/useFileTarget.ts"
import { useAccountSession } from "../composables/useAccountSession.ts"
import { usePlatformClient } from "../composables/usePlatformClient.ts"
import { useConnectionResume } from "../composables/useConnectionResume.ts"
import { useWorkspaceConversation } from "../composables/useWorkspaceConversation.ts"
import { groupWorkspaceApprovals, hasTicketStatus, missingWorker, stoppableSteps, workerSummary, workspaceMessageRows, type WorkspaceReplyProgress as ReplyProgress } from "../services/workspace-message-timeline.ts"
import { workspaceAgentRoute, workspaceSessionRoute } from "../services/workspace-agent-navigation.ts"
import { useAgentSessionsStore } from "../stores/agent-sessions.ts"
import { useFleetStore } from "../stores/fleet.ts"
import { useProvidersStore } from "../stores/providers.ts"

const props = defineProps<{ api: NonNullable<DeskfleetDesktopApi["superAgent"]>; workspaceId: SuperWorkspaceId }>()
const router = useRouter()
const account = useAccountSession()
const fleet = useFleetStore()
const agents = useAgentSessionsStore()
const providers = useProvidersStore()
const client = usePlatformClient()
const touchWorkspace = !!(client.mobile && client.remoteWorkspaceAgent)
const { t } = useI18n()
const workspaceName = (id: string) => fleet.findWorkspace(id)?.workspace.name ?? t("superAgent.workspace")
const conversationName = (id: SuperWorkspaceId) => id === null ? t("superAgent.defaultWorkspace") : workspaceName(id)
const name = computed(() => conversationName(props.workspaceId))
const goToProject = (id: string) => { void router.push(workspaceAgentRoute(fleet.targetId, id, account?.teamId.value)) }
const project = computed(() => props.workspaceId ? fleet.findWorkspace(props.workspaceId) : undefined)
const location = computed(() => {
  if (project.value) return project.value
  const machine = fleet.findMachine(fleet.targetId)
  return machine ? { machine } : null
})
const machineTarget = useFileTarget(() => location.value?.machine.id)
const resourceTarget = useTranscriptFileTarget(() => machineTarget.value, () => props.workspaceId)
const deviceOnline = touchWorkspace ? useOnline() : undefined
const machinePresence = computed(() => account?.machines.value.find(item => item.id === fleet.targetId))
const offlineMachine = computed(() => {
  if (!touchWorkspace) return
  const machine = machinePresence.value
  if (deviceOnline?.value === false || machine?.online === false) return machine ?? location.value?.machine
})
const { snapshot, draft, attachments, mentions, missingAttachments, discardMissing, error, sending, saving, refresh, canRefresh, commandMenu, canSendPlain, send, retry, correct, saveSettings, stop, localStops, archiveTicket, feedbackMap, loadProcess } = useWorkspaceConversation(props.api, props.workspaceId, goToProject, () => !!offlineMachine.value)
if (touchWorkspace) useConnectionResume(() => { void refresh() })
const workers = computed(() => snapshot.value?.workerProviders ?? providers.providers)
const providerName = (id: string) => workers.value.find(provider => provider.id === id)?.name ?? id
const messages = computed(() => snapshot.value?.messages ?? [])
const tickets = computed(() => new Map(snapshot.value?.tickets.map(ticket => [ticket.id, ticket]) ?? []))
const activeTickets = computed(() => (snapshot.value?.tickets ?? []).filter(ticket => !ticket.archiveState))
const archivedTickets = computed(() => (snapshot.value?.tickets ?? []).filter(ticket => ticket.archiveState))
const ticketMenuOpen = ref(false)
const followUpMenuOpen = ref(false)
const followUpBusy = ref(false)
const followUpError = ref("")
const followUpSources = ref<FollowUpSourcesResponse>()
const followUpRuns = ref<FollowUpRunRecord[]>([])
const followUpRunsCursor = ref<{ createdAt: string; id: string }>()
const machineName = computed(() => account?.machine.value?.name ?? location.value?.machine.name ?? fleet.localDesktopTarget.name)
const pendingAuthScheduleCount = computed(() => snapshot.value?.followUp?.pendingAuthScheduleCount ?? 0)
const takeoverActive = computed(() =>
  !!snapshot.value?.followUp?.authorized && snapshot.value?.followUp?.takeoverAllSessions === true,
)
const needsFollowUpConsent = computed(() =>
  !!snapshot.value?.supportsProactiveFollowUp
  && !!props.api.followUpAuth
  && !takeoverActive.value
  && (!!snapshot.value.followUp?.needsConsent || pendingAuthScheduleCount.value > 0),
)

async function loadFollowUpPanel(append = false) {
  if (!snapshot.value?.supportsProactiveFollowUp || !props.api.followUpSources || !props.api.followUpRuns) return
  followUpBusy.value = true
  followUpError.value = ""
  try {
    if (!append) {
      followUpSources.value = await props.api.followUpSources({ workspaceId: props.workspaceId })
      const page = await props.api.followUpRuns({ workspaceId: props.workspaceId ?? undefined, limit: 10 })
      followUpRuns.value = page.runs
      followUpRunsCursor.value = page.nextCursor
    } else if (followUpRunsCursor.value) {
      const page = await props.api.followUpRuns({ workspaceId: props.workspaceId ?? undefined, cursor: followUpRunsCursor.value, limit: 10 })
      followUpRuns.value = [...followUpRuns.value, ...page.runs]
      followUpRunsCursor.value = page.nextCursor
    }
  } catch (reason) {
    followUpError.value = reason instanceof Error ? reason.message : String(reason)
  } finally { followUpBusy.value = false }
}

watch(followUpMenuOpen, open => { if (open) void loadFollowUpPanel(false) })

async function consentBackgroundFollowUp() {
  if (followUpBusy.value || !props.api.followUpAuth) return
  followUpBusy.value = true
  followUpError.value = ""
  try {
    const receipt = await enableTakeoverOnMachine(props.api, {
      serverUrl: account?.account.value.serverUrl,
      userId: account?.account.value.user?.id,
      teamId: account?.teamId.value,
      machineId: fleet.targetId,
    }, { platform: client.platform, deviceLabel: client.platform, machineName: machineName.value })
    if (receipt.status === "stale_ignored" || !receipt.authorized || receipt.summary?.takeoverAllSessions !== true) {
      followUpError.value = t("superAgent.followUp.takeoverAllAuthFailed")
    }
    await refresh()
  } catch (reason) {
    followUpError.value = reason instanceof Error ? reason.message : String(reason)
  } finally { followUpBusy.value = false }
}

async function toggleUnifiedTakeover(nextEnabled: boolean) {
  if (followUpBusy.value || !props.api.followUpAuth) return
  followUpBusy.value = true
  followUpError.value = ""
  try {
    const targetScope = {
      serverUrl: account?.account.value.serverUrl,
      userId: account?.account.value.user?.id,
      teamId: account?.teamId.value,
      machineId: fleet.targetId,
    }
    if (nextEnabled) {
      const receipt = await enableTakeoverOnMachine(props.api, targetScope, {
        platform: client.platform,
        deviceLabel: client.platform,
        machineName: machineName.value,
      })
      if (receipt.status === "stale_ignored" || !receipt.authorized || receipt.summary?.takeoverAllSessions !== true) {
        followUpError.value = t("superAgent.followUp.takeoverAllAuthFailed")
      }
    } else {
      await disableTakeoverOnMachine(props.api, targetScope)
    }
    await loadFollowUpPanel(false)
    await refresh()
  } catch (reason) {
    followUpError.value = reason instanceof Error ? reason.message : String(reason)
  } finally { followUpBusy.value = false }
}

async function updateFollowedSource(workspaceId: string, sourceKind: "schedule" | "session", sourceId: string, changes: { enabled?: boolean; reconfirmOwnership?: boolean; adopt?: boolean }) {
  if (followUpBusy.value || !props.api.followUpUpdateSource) return
  followUpBusy.value = true
  followUpError.value = ""
  try {
    await props.api.followUpUpdateSource({ workspaceId, sourceKind, sourceId, ...changes })
    await loadFollowUpPanel(false)
    await refresh()
  } catch (reason) {
    followUpError.value = reason instanceof Error ? reason.message : String(reason)
  } finally { followUpBusy.value = false }
}

function scheduleRoute(scheduleId: string) {
  return { name: "schedules", params: { scheduleId } }
}

const confirmingArchive = ref<{ ticket: SuperTicket; archive: boolean; operationId: string }>()
function canChangeTicketArchive(ticket: SuperTicket) {
  return !!snapshot.value?.supportsTicketArchive && !!props.api.archiveTicket && (!ticket.sessionId || !!ticket.workerContext)
}
function chooseArchive(ticket: SuperTicket) {
  confirmingArchive.value = { ticket, archive: ticket.archiveState !== "archived", operationId: crypto.randomUUID() }
  ticketMenuOpen.value = false
}
const archiveDescription = computed(() => {
  const choice = confirmingArchive.value
  if (!choice) return ""
  if (!choice.ticket.sessionId) return t(choice.archive ? "superAgent.archiveUnbound" : "superAgent.restoreUnbound")
  if (choice.ticket.workerContext === "worktree") return t(choice.archive ? "agent.archiveWorktreeQuestion" : "agent.restoreWorktreeQuestion")
  return t(choice.archive ? "agent.archiveQuestion" : "agent.restoreQuestion")
})
async function confirmArchive() {
  const choice = confirmingArchive.value
  if (choice) await archiveTicket(choice.ticket.id, choice.ticket.sessionId ?? null, choice.archive, choice.operationId)
}
const requestKey = (request: SuperWorkerRequest) => JSON.stringify([request.item.sessionId, request.kind, request.item.id])
watch(() => snapshot.value?.pendingRequests, (current, previous) => {
  if (!current || !previous?.length) return
  const pending = new Set(current.filter(request => request.item.state === "pending").map(requestKey))
  for (const { kind, item } of previous.filter(request => !pending.has(requestKey(request)))) agents.clearWorkerRequest(item.sessionId, kind, item.id)
})
const lastUserMessage = computed(() => messages.value.findLast(message => message.role === "user")?.id)
const byId = computed(() => new Map(messages.value.map(message => [message.id, message])))
const feedbackById = computed(() => {
  const map = new Map<string, SuperFeedbackItem>()
  for (const entry of feedbackMap.value.values()) {
    if (entry.ack) map.set(entry.ack.itemId, entry.ack)
    for (const milestone of entry.milestones) map.set(milestone.itemId, milestone)
  }
  return map
})
const quoted = computed(() => {
  if (!draft.replyTo) return undefined
  const existing = byId.value.get(draft.replyTo)
  if (existing) return existing
  const item = feedbackById.value.get(draft.replyTo)
  if (!item) return undefined
  return { id: item.itemId, role: "assistant" as const, text: item.text, createdAt: item.createdAt, ticketId: item.ticketId, sourceMessageId: item.sourceMessageId }
})
function replyQuoteText(id: string): string | undefined {
  const existing = byId.value.get(id)
  if (existing) return quoteText(existing)
  return feedbackById.value.get(id)?.text
}
const editor = useTemplateRef<InstanceType<typeof SessionComposer>>("editor")
const githubOpen = ref(false)
function insertGithub(item: GithubRepositoryItem) {
  attachments.value = withGithubReference(attachments.value, item)
  githubOpen.value = false
}
const unsupportedAttachments = computed(() => !!attachments.value.length && !!snapshot.value && !snapshot.value.supportsAttachments)
const attachmentScope = computed(() => JSON.stringify([account?.account?.value.user?.id, account?.teamId.value, fleet.targetId, props.workspaceId]))
const attachmentPreviews = computed(() => !!snapshot.value?.supportsAttachmentPreviews && !offlineMachine.value)
const readAttachment = computed(() => {
  if (!attachmentPreviews.value) return undefined
  const scope = attachmentScope.value
  const { workspaceId, api } = props
  return async (messageId: string, index: number) => {
    const result = await api.snapshot({ workspaceId, attachment: { messageId, index } })
    const preview = result.attachmentPreview
    if (attachmentScope.value === scope && props.api === api && result.workspaceId === workspaceId && preview?.messageId === messageId && preview.index === index) return preview.content
    throw new Error("Attachment unavailable")
  }
})
function quoteText(message: SuperMessage) {
  return message.text || message.attachments?.map(item => item.name).join(", ")
}
const scrollArea = useTemplateRef<InstanceType<typeof UiScrollArea>>("scrollArea")
const transcript = useTemplateRef<HTMLElement>("transcript")
const viewport = computed(() => scrollArea.value?.viewportElement)
const reading = useConversationReadingStore().session(JSON.stringify(["workspace", account?.account?.value.user?.id, account?.teamId.value, fleet.targetId, props.workspaceId]))
const stickToBottom = ref(reading.scroll?.bottom ?? true)
const activeEntry = ref<string>()
let spring: SpringScroll | undefined
const showSettings = ref(false)
watch(() => providers.providers, () => { void refresh() })
watch(showSettings, visible => { if (visible) void refresh() })
const correcting = ref<string>()
const target = ref("")
const details = ref<string>()
const busy = computed(() => sending.value || saving.value || !!offlineMachine.value)
const rows = computed(() => workspaceMessageRows(messages.value, tickets.value, localStops.value, feedbackMap.value))
const activeProgressSources = computed(() => new Set(rows.value.flatMap(row => row.progress ? [row.progress.sourceId] : [])))
const lastMessageByTicket = computed(() => {
  const latest = new Map<string, string>()
  for (const { message, ticket, jobs } of rows.value) {
    if (ticket) latest.set(ticket.id, message.id)
    for (const job of jobs) latest.set(job.ticket.id, message.id)
  }
  return latest
})
const supportsStop = computed(() => !!props.api.stop && snapshot.value?.supportsStop === true)
const stopChoices = computed(() => supportsStop.value ? rows.value.flatMap(({ progress }) =>
  progress && stoppableSteps(progress).length ? [progress] : []) : [])
const choosingStop = ref(false)
watch(() => stopChoices.value.length, count => { if (!count) choosingStop.value = false })
const stopUnreachable = computed(() => !!offlineMachine.value || machinePresence.value?.online === false || canRefresh.value)
const stopDisabled = computed(() => busy.value || stopUnreachable.value)
function stopLabel(choice: ReplyProgress) {
  const steps = stoppableSteps(choice)
  if (steps.length === 1) return t(steps[0]?.sharedTurn ? "superAgent.stop.turn" : "superAgent.stop.request")
  return t(steps.some(step => step.sharedTurn) ? "superAgent.stop.groupShared" : "superAgent.stop.group", { count: steps.length })
}
const cancelLabel = computed(() => stopChoices.value.length === 1 ? stopLabel(stopChoices.value[0]!) : t("superAgent.stop.choose"))
function composerStop() {
  if (stopDisabled.value) return
  if (stopChoices.value.length === 1) void stop(stopChoices.value[0]!)
  else choosingStop.value = stopChoices.value.length > 1
}
const transcriptGroups = computed(() => groupWorkspaceApprovals(rows.value))
const expandedApprovals = ref(new Set<string>())
const locatedMessage = ref<string>()
const { start: clearHighlightLater } = useTimeoutFn(() => { locatedMessage.value = undefined }, 2000, { immediate: false })
watch(attachmentScope, () => expandedApprovals.value.clear())
function toggleApprovals(id: string) {
  if (expandedApprovals.value.has(id)) expandedApprovals.value.delete(id)
  else expandedApprovals.value.add(id)
}
const progressText = (summary: string) => workerSummary(summary, t("superAgent.actions.workerNotStarted"))
function correctionSource(message?: SuperMessage) {
  if (!message) return
  const source = message.role === "user" ? message : byId.value.get(message.sourceMessageId ?? "")
  if (source?.role === "user" && source.state !== "transferred" && source.state !== "stopped") return source
}
const original = computed(() => correcting.value ? correctionSource(byId.value.get(correcting.value)) : undefined)
const correctionChoices = computed(() => {
  const current = original.value?.ticketId
  return activeTickets.value.filter(ticket => ticket.id !== current)
})
const outline = computed(() => {
  const items = new Map<string, { id: string; label: string; reply?: string }>()
  for (const { message } of rows.value) {
    if (message.role === "user") items.set(message.id, { id: message.id, label: quoteText(message) ?? "" })
    else if (message.sourceMessageId && message.text && message.workerEvent !== "permission") {
      const item = items.get(message.sourceMessageId)
      if (item) item.reply = message.text
    }
  }
  return [...items.values()]
})
function sourceForOutline(message?: SuperMessage) {
  if (message?.role === "user") return message.id
  if (message?.sourceMessageId && byId.value.get(message.sourceMessageId)?.role === "user") return message.sourceMessageId
}
const lastOutlineEntry = computed(() => sourceForOutline(rows.value.findLast(row => sourceForOutline(row.message))?.message))
function entries() {
  return Array.from(transcript.value?.querySelectorAll<HTMLElement>("[data-outline-source]") ?? [])
}
function followScroll() {
  const el = viewport.value
  if (!el || spring || !snapshot.value) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 100
  reading.scroll = { top: el.scrollTop, bottom: stickToBottom.value }
  if (stickToBottom.value) activeEntry.value = lastOutlineEntry.value
  else {
    const items = entries()
    const top = el.getBoundingClientRect().top + 80
    activeEntry.value = (items.findLast(item => item.getBoundingClientRect().top <= top) ?? items[0])?.dataset.outlineSource
  }
}
function locateEntry(id: string) {
  const entry = transcript.value?.querySelector<HTMLElement>(`[data-super-message="${CSS.escape(id)}"]`)
  if (!entry) return
  spring?.cancel()
  spring = undefined
  stickToBottom.value = false
  entry.scrollIntoView({ block: "start", behavior: "instant" })
  activeEntry.value = entry.dataset.outlineSource
}
async function locateTicket(ticketId: string) {
  const id = lastMessageByTicket.value.get(ticketId)
  if (!id) return
  const group = transcriptGroups.value.find(group => group.approvals && group.rows.some(row => row.message.id === id))
  if (group) expandedApprovals.value.add(group.id)
  ticketMenuOpen.value = false
  locatedMessage.value = id
  await nextTick()
  locateEntry(id)
  clearHighlightLater()
}
function scrollToBottom() {
  const el = viewport.value
  if (!el) return
  stickToBottom.value = true
  const animation = scrollSpring(el, el.scrollHeight)
  spring = animation
  void animation.finished.then(() => { if (spring === animation) { spring = undefined; followScroll() } })
}
function followNewContent() {
  if (snapshot.value && stickToBottom.value && viewport.value && !spring) {
    viewport.value.scrollTop = viewport.value.scrollHeight
    activeEntry.value = lastOutlineEntry.value
  }
}
watch(() => !!snapshot.value, async ready => {
  if (!ready) return
  await nextTick()
  if (!stickToBottom.value && viewport.value && reading.scroll) viewport.value.scrollTop = reading.scroll.top
  followNewContent()
})
watch(() => rows.value.at(-1)?.message.id, followNewContent, { flush: "post" })
useResizeObserver(transcript, followNewContent)
onBeforeUnmount(() => { spring?.cancel(); spring = undefined })
function quote(message: Pick<SuperMessage, "id">) {
  draft.replyTo = message.id
  editor.value?.focus()
}
async function submit() {
  stickToBottom.value = true
  await send()
}
function chooseCorrection(id: string) {
  correcting.value = id
  target.value = ""
}
async function applyCorrection() {
  if (original.value && target.value && await correct(original.value.id, target.value)) correcting.value = undefined
}
function sessionRoute(sessionId: string) {
  return workspaceSessionRoute(fleet.targetId, props.workspaceId, sessionId, account?.teamId.value)
}
function toggleDetails(id: string) {
  details.value = details.value === id ? undefined : id
  correcting.value = undefined
}
function supportsFork(sessionId: string) {
  const session = agents.sessions[sessionId]
  return !session || session.archiveState === "active" && session.lifecycle === "ready" && !!session.capabilities?.fork
}
function openFork(sessionId: string, turnId: string) {
  const route = sessionRoute(sessionId)
  void router.push({ ...route, query: { ...route.query, forkTurn: turnId } })
}
function canCorrect(message: SuperMessage) {
  const source = correctionSource(message)
  return !!source && !source.command && activeTickets.value.some(ticket => ticket.id !== source.ticketId)
}
</script>

<template>
  <PaneHeader>
    <span class="inline-flex items-center gap-2"><Folder v-if="workspaceId" :size="15" aria-hidden="true" /><MessagesSquare v-else :size="15" aria-hidden="true" />{{ name }}</span>
    <template #actions>
      <PopoverRoot v-if="workspaceId && project?.workspace.githubRepositories?.length" v-model:open="githubOpen">
        <PopoverTrigger type="button" :aria-label="t('githubSettings.title')" :title="t('githubSettings.title')" :class="touchWorkspace && 'min-h-11 min-w-11'" class="app-no-drag ui-button-ghost h-7 px-2 data-[state=open]:bg-ui-hover">
          <GithubIcon :size="16" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent :as="SpringSurface" align="end" :side-offset="6" :collision-padding="8" :aria-label="t('githubSettings.title')" class="ui-menu z-50 h-[min(60dvh,var(--reka-popover-content-available-height))] w-96 max-w-[calc(100vw-1rem)] overflow-hidden p-0">
            <GithubPanel :workspace-id="workspaceId" :insert-disabled="!snapshot?.supportsAttachments || sending || saving" @insert="insertGithub" />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
      <PopoverRoot v-if="snapshot?.supportsProactiveFollowUp" v-model:open="followUpMenuOpen">
        <PopoverTrigger type="button" data-follow-up-menu :class="touchWorkspace && 'min-h-11'" class="app-no-drag ui-button-ghost h-7 px-2 data-[state=open]:bg-ui-hover">
          <CalendarClock :size="15" aria-hidden="true" />{{ t("superAgent.followUp.history") }}
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent :as="SpringSurface" align="end" :side-offset="6" :collision-padding="8" :aria-label="t('superAgent.followUp.history')" class="ui-menu z-50 w-96 max-w-[calc(100vw-1rem)] max-h-[min(65dvh,var(--reka-popover-content-available-height))] overflow-y-auto overscroll-contain p-3">
            <div class="flex items-center justify-between gap-2 pb-2">
              <span class="text-xs font-medium text-ui-text-muted">{{ t("superAgent.followUp.history") }}</span>
              <RouterLink :to="{ name: 'schedules' }" class="text-xs text-ui-accent no-underline hover:underline">{{ t("superAgent.followUp.openSchedules") }}</RouterLink>
            </div>
            <div v-if="props.api.followUpAuth" class="mb-3 flex items-center justify-between gap-2 rounded-lg border border-ui-border px-2.5 py-2 text-xs">
              <div class="min-w-0">
                <div class="font-medium">{{ t("superAgent.followUp.takeoverAllLabel") }}</div>
                <div class="text-ui-text-muted">
                  <template v-if="followUpSources?.auth.authorized && followUpSources?.auth.takeoverAllSessions">{{ t("superAgent.followUp.takeoverAllActive", { machine: machineName }) }}</template>
                  <template v-else>{{ t("superAgent.followUp.takeoverAllDescription", { machine: machineName }) }}</template>
                </div>
              </div>
              <UiButton v-if="!(followUpSources?.auth.authorized && followUpSources?.auth.takeoverAllSessions)" type="button" size="sm" variant="primary" data-follow-up-takeover-enable :disabled="followUpBusy" @click="toggleUnifiedTakeover(true)">{{ t("superAgent.followUp.resumeFollowUp") }}</UiButton>
              <UiButton v-else type="button" size="sm" data-follow-up-takeover-disable :disabled="followUpBusy" @click="toggleUnifiedTakeover(false)">{{ t("superAgent.followUp.stopFollowUp") }}</UiButton>
            </div>
            <p v-if="followUpError" role="alert" class="my-1 text-xs text-ui-danger">{{ followUpError }}</p>
            <div v-if="followUpSources?.sources.length" class="mb-3 flex flex-col gap-2 border-b border-ui-border pb-3">
              <div v-for="source in followUpSources.sources" :key="source.id" class="flex items-start justify-between gap-2 text-xs">
                <div class="min-w-0">
                  <div class="truncate font-medium">{{ source.state.scheduleTitle ?? source.sourceId }}</div>
                  <div class="text-ui-text-muted">
                    <template v-if="source.state.pausedReason === 'modified_by_other_member'">{{ t("superAgent.followUp.ownershipPaused") }}</template>
                    <template v-else-if="source.state.pausedReason === 'awaiting_authorization'">{{ t("superAgent.followUp.awaitingAuthorization") }}</template>
                    <template v-else-if="source.state.enabled">{{ t("superAgent.followUp.followed") }}</template>
                    <template v-else>{{ t("superAgent.followUp.followUpStopped") }}</template>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <RouterLink v-if="source.sourceKind === 'schedule'" :to="scheduleRoute(source.sourceId)" class="text-ui-accent no-underline hover:underline">{{ t("superAgent.followUp.openSchedule") }}</RouterLink>
                  <RouterLink v-else :to="sessionRoute(source.sourceId)" class="text-ui-accent no-underline hover:underline">{{ t("superAgent.openSession") }}</RouterLink>
                  <button v-if="source.state.pausedReason === 'modified_by_other_member'" type="button" class="text-ui-accent" :disabled="followUpBusy" @click="updateFollowedSource(source.workspaceId, source.sourceKind, source.sourceId, { enabled: true, reconfirmOwnership: true })">{{ t("superAgent.followUp.reconfirmOwnership") }}</button>
                  <button v-else-if="source.state.enabled" type="button" class="text-ui-text-muted hover:text-ui-text" :disabled="followUpBusy" @click="updateFollowedSource(source.workspaceId, source.sourceKind, source.sourceId, { enabled: false })">{{ t(source.sourceKind === 'schedule' ? "superAgent.followUp.stopFollowUp" : "superAgent.followUp.viewInSessionOnly") }}</button>
                  <button v-else type="button" class="text-ui-accent" :disabled="followUpBusy" @click="updateFollowedSource(source.workspaceId, source.sourceKind, source.sourceId, { enabled: true })">{{ t("superAgent.followUp.resumeFollowUp") }}</button>
                </div>
              </div>
            </div>
            <div v-if="followUpRuns.length" class="flex flex-col gap-2">
              <div v-for="run in followUpRuns" :key="run.id" class="rounded-lg border border-ui-border px-2.5 py-2 text-xs">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-medium">{{ run.scheduleTitle ?? run.sourceId }} · {{ run.status }}</span>
                  <div class="flex shrink-0 items-center gap-2">
                    <RouterLink v-if="run.scheduleId" :to="scheduleRoute(run.scheduleId)" class="text-ui-accent no-underline hover:underline">{{ t("superAgent.followUp.openSchedule") }}</RouterLink>
                    <RouterLink v-if="run.sessionId && run.evidenceAvailability !== 'deleted'" :to="sessionRoute(run.sessionId)" class="text-ui-accent no-underline hover:underline">{{ t("superAgent.openSession") }}</RouterLink>
                  </div>
                </div>
                <p class="my-1 whitespace-pre-wrap text-ui-text-muted">{{ run.summary }}</p>
                <p v-if="run.evidenceAvailability !== 'available'" class="m-0 text-[11px] text-ui-text-faint">{{ t(run.evidenceAvailability === 'archived' ? 'superAgent.followUp.evidenceArchived' : run.evidenceAvailability === 'deleted' ? 'superAgent.followUp.evidenceDeleted' : run.evidenceAvailability === 'partial' ? 'superAgent.followUp.evidencePartial' : 'superAgent.followUp.evidenceRestricted') }}</p>
              </div>
              <UiButton v-if="followUpRunsCursor" type="button" size="sm" :loading="followUpBusy" @click="loadFollowUpPanel(true)">{{ t("superAgent.followUp.loadMore") }}</UiButton>
            </div>
            <p v-else class="m-0 text-xs text-ui-text-muted">{{ t("superAgent.followUp.noRuns") }}</p>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
      <PopoverRoot v-if="tickets.size" v-model:open="ticketMenuOpen">
        <PopoverTrigger type="button" :class="touchWorkspace && 'min-h-11'" class="app-no-drag ui-button-ghost h-7 px-2 data-[state=open]:bg-ui-hover">
          <ClipboardList :size="15" aria-hidden="true" />{{ t("superAgent.tickets", { count: activeTickets.length }) }}
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent :as="SpringSurface" align="end" :side-offset="6" :collision-padding="8" :aria-label="t('superAgent.ticketList')" class="ui-menu z-50 w-96 max-w-[calc(100vw-1rem)] max-h-[min(60dvh,var(--reka-popover-content-available-height))] overflow-y-auto overscroll-contain p-3">
            <template v-for="group in [{ archived: false, items: activeTickets }, { archived: true, items: archivedTickets }]" :key="String(group.archived)">
              <component :is="group.archived ? 'details' : 'div'" v-if="group.items.length">
                <summary v-if="group.archived" :class="touchWorkspace && 'min-h-11 py-2'" class="cursor-pointer py-1.5 text-sm text-ui-text-muted">{{ t("superAgent.archivedTickets", { count: group.items.length }) }}</summary>
                <div v-for="ticket in group.items" :key="ticket.id" class="flex items-start gap-1">
                  <details class="min-w-0 flex-1 break-words py-1.5">
                    <summary :class="touchWorkspace && 'min-h-11 py-2'" class="cursor-pointer text-sm font-medium">{{ ticket.title }} <small v-if="ticket.archiveState === 'archiving'" class="text-ui-text-muted">{{ t('superAgent.archivingTicket') }}</small><small v-else-if="!ticket.archiveState && hasTicketStatus(ticket.status)" class="text-ui-text-muted">{{ t(`superAgent.status.${ticket.status}`) }}</small></summary>
                    <p class="my-1.5 whitespace-pre-wrap text-sm">{{ ticket.scope }}</p>
                    <p v-if="ticket.latestAcceptance" class="my-1 select-text whitespace-pre-wrap text-sm">{{ t('superAgent.acceptance', { text: ticket.latestAcceptance }) }}</p>
                    <p v-if="ticket.summary && ticket.summary !== ticket.scope" class="my-1.5 whitespace-pre-wrap text-sm text-ui-text-muted">{{ progressText(ticket.summary) }}</p>
                    <p v-if="ticket.referenceTicketId && tickets.has(ticket.referenceTicketId)" class="my-1 text-xs text-ui-text-muted">{{ t('superAgent.reference', { name: tickets.get(ticket.referenceTicketId)?.title }) }}</p>
                    <div class="flex flex-wrap items-center gap-x-3 text-xs text-ui-accent" :class="touchWorkspace && 'workspace-touch-actions'">
                      <RouterLink v-if="ticket.sessionId && (!snapshot?.supportsTicketArchive || ticket.workerContext)" :to="sessionRoute(ticket.sessionId)" class="inline-flex items-center">{{ t('superAgent.openSession') }}</RouterLink>
                      <button v-if="canChangeTicketArchive(ticket)" type="button" :disabled="busy" @click="chooseArchive(ticket)">{{ t(ticket.archiveState === 'archived' ? 'superAgent.restoreTicket' : 'superAgent.archiveTicket') }}</button>
                      <span v-else-if="ticket.archiveState && ticket.sessionId && !ticket.workerContext" class="text-ui-text-muted">{{ t('superAgent.workerUnavailable') }}</span>
                    </div>
                  </details>
                  <div class="mt-0.5 flex shrink-0 items-center">
                    <UiButton variant="ghost" size="icon" :class="touchWorkspace && 'min-h-11 min-w-11'"
                      :label="t('superAgent.locateTicketMessage', { name: ticket.title })" :disabled="!lastMessageByTicket.has(ticket.id)" @click="locateTicket(ticket.id)">
                      <MapPin :size="16" :stroke-width="1.75" aria-hidden="true" />
                    </UiButton>
                    <UiButton v-if="!group.archived && canChangeTicketArchive(ticket)" variant="ghost" size="icon"
                      :class="touchWorkspace && 'min-h-11 min-w-11'"
                      :label="t('superAgent.archiveTicket') + ' · ' + ticket.title" :disabled="busy" @click="chooseArchive(ticket)">
                      <Archive :size="16" :stroke-width="1.75" aria-hidden="true" />
                    </UiButton>
                  </div>
                </div>
              </component>
            </template>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </template>
  </PaneHeader>
  <ConfirmDialog v-if="confirmingArchive" :title="t(confirmingArchive.archive ? 'superAgent.archiveTicket' : 'superAgent.restoreTicket') + ' · ' + confirmingArchive.ticket.title"
    :description="archiveDescription" :confirm-label="t(confirmingArchive.archive ? 'superAgent.archiveTicket' : 'superAgent.restoreTicket')" :confirm-disabled="busy"
    :tone="confirmingArchive.archive && confirmingArchive.ticket.workerContext === 'worktree' ? 'danger' : 'primary'" :confirm="confirmArchive" @close="confirmingArchive = undefined" />
  <div v-if="needsFollowUpConsent" data-follow-up-consent-banner role="region" class="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ui-border px-6 py-2.5 text-xs">
    <span class="text-ui-text-muted">{{ pendingAuthScheduleCount > 0 ? t("superAgent.followUp.pendingAuthPrompt", { machine: machineName, count: pendingAuthScheduleCount }, pendingAuthScheduleCount) : t("superAgent.followUp.consentPrompt", { machine: machineName }) }}</span>
    <UiButton type="button" size="sm" variant="primary" data-follow-up-consent-enable :loading="followUpBusy" @click="consentBackgroundFollowUp">{{ t("superAgent.followUp.takeoverAllLabel") }}</UiButton>
  </div>
  <div class="relative flex min-h-0 flex-1">
    <UiScrollArea ref="scrollArea" fade="top" class="min-h-0 min-w-0 flex-1" content-class="flex min-h-full flex-col" data-session-scroll-area
      :viewport-attrs="{ 'data-session-scroll-viewport': '', onScroll: followScroll }">
      <div ref="transcript" class="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col px-6 py-6">
        <p v-if="!snapshot && !error && !offlineMachine" role="status" class="m-auto text-sm text-ui-text-muted">{{ t('agent.loading') }}</p>
        <h1 v-else-if="snapshot && !messages.length" class="m-auto text-center text-2xl font-medium tracking-tight">{{ t('superAgent.empty', { name }) }}</h1>
        <ol v-else class="flex flex-col gap-6 text-[15px] leading-[1.65]" :aria-label="t('agent.conversation')">
          <template v-for="group in transcriptGroups" :key="group.id">
            <li v-if="group.approvals" :data-approval-history="group.id" :data-outline-source="sourceForOutline(group.rows[0]?.message)" class="min-w-0">
              <button type="button" :aria-expanded="expandedApprovals.has(group.id)" :title="group.rows[0]?.ticket?.title"
                :class="touchWorkspace && 'min-h-11'" class="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left text-sm text-ui-text-muted hover:text-ui-text"
                @click="toggleApprovals(group.id)">
                <ChevronRight :size="14" class="shrink-0 ui-motion" :class="expandedApprovals.has(group.id) && 'rotate-90'" aria-hidden="true" />
                {{ t(group.approvals === 'handled' ? 'superAgent.approvalsHandled' : 'superAgent.approvalsRecorded', { count: group.rows.length }, group.rows.length) }}
              </button>
            </li>
          <template v-for="{ message, progress, feedback, ticket, sessions, detailSummary, jobs, fork, workerMissing, workerFailure, perTicketFailures } in (!group.approvals || expandedApprovals.has(group.id) ? group.rows : [])" :key="message.id">
            <li :data-super-message="message.id" :data-conversation-located="locatedMessage === message.id || undefined" :data-outline-source="sourceForOutline(message)" :data-conversation-entry="message.role === 'user' ? message.id : undefined" class="min-w-0 scroll-mt-6"
              :class="{ 'workspace-touch-actions': touchWorkspace, 'ui-conversation-history': !progress && message.id !== rows.at(-1)?.message.id && details !== message.id && activeEntry !== message.id && locatedMessage !== message.id, 'ui-conversation-input': message.role === 'user' }">
              <WorkspaceMessage :resource-target="message.role === 'worker' ? resourceTarget : undefined" :read-attachment="readAttachment" :message="message" :touch="touchWorkspace" :animate-send="message.id === lastUserMessage" :can-fork="!!fork && supportsFork(fork.sessionId)" :fork-disabled="!!offlineMachine"
                @quote="quote(message)" @fork="fork && openFork(fork.sessionId, fork.turnId)">
                <template #heading>
                  <button v-if="ticket || jobs.length || sessions.length || canCorrect(message)" type="button" :class="touchWorkspace && 'min-h-11'" class="inline-flex items-center gap-0.5 text-ui-accent" :aria-expanded="details === message.id" @click="toggleDetails(message.id)">
                    {{ jobs.length > 1 ? t('superAgent.tickets', { count: jobs.length }) : ticket?.title ?? t('superAgent.ticketDetails') }}<ChevronDown :size="12" :class="details === message.id && 'rotate-180'" aria-hidden="true" />
                  </button>
                </template>
                <template #before>
                  <div v-if="details === message.id" class="mb-2 rounded-lg border border-ui-border px-3 py-2 text-xs">
                    <template v-if="ticket">
                      <span v-if="hasTicketStatus(ticket.status)">{{ t(`superAgent.status.${ticket.status}`) }}<template v-if="ticket.provider"> · </template></span><span v-if="ticket.provider">{{ providerName(ticket.provider) }}</span>
                      <p class="my-1 select-text whitespace-pre-wrap">{{ ticket.scope }}</p>
                      <p v-if="ticket.latestAcceptance" class="my-1 select-text whitespace-pre-wrap text-sm">{{ t('superAgent.acceptance', { text: ticket.latestAcceptance }) }}</p>
                      <p v-if="detailSummary" class="my-1 select-text whitespace-pre-wrap text-ui-text-muted">{{ progressText(detailSummary) }}</p>
                    </template>
                    <p v-if="message.reason && message.state !== 'failed' && message.state !== 'uncertain'" class="my-1 select-text whitespace-pre-wrap text-ui-text-muted">{{ message.reason }}</p>
                    <div :class="touchWorkspace && 'workspace-touch-actions'" class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <RouterLink v-for="session in sessions" :key="session.id" :to="sessionRoute(session.id)" class="inline-flex items-center text-ui-accent">{{ session.title ? t('superAgent.openTicketSession', { name: session.title }) : t('superAgent.openSession') }}</RouterLink>
                      <button v-if="canCorrect(message)" type="button" class="text-ui-accent" @click="chooseCorrection(message.id)">{{ t('superAgent.correct') }}</button>
                    </div>
                    <form v-if="correcting === message.id" class="mt-2 flex flex-wrap gap-2" @submit.prevent="applyCorrection">
                      <select v-model="target" :aria-label="t('superAgent.targetTicket')" class="max-w-full rounded border border-ui-border bg-ui-canvas p-1 text-sm">
                        <option value="" disabled>{{ t('superAgent.targetTicket') }}</option><option v-for="item in correctionChoices" :key="item.id" :value="item.id">{{ item.title }}</option>
                      </select>
                      <UiButton type="submit" size="sm" :disabled="!target || busy">{{ t('superAgent.apply') }}</UiButton>
                      <UiButton variant="ghost" size="sm" @click="correcting = undefined">{{ t('catalog.cancel') }}</UiButton>
                    </form>
                  </div>
                  <blockquote v-if="message.replyTo && replyQuoteText(message.replyTo)" class="m-0 mb-1 max-w-full truncate border-l-2 border-ui-accent pl-2 text-xs text-ui-text-muted">{{ replyQuoteText(message.replyTo) }}</blockquote>
                </template>
                <WorkspaceReplyProgress v-if="progress && message.role !== 'user'" :progress="progress" :supports-stop="supportsStop" :disabled="stopDisabled" :unreachable="stopUnreachable" :feedback="message.sourceMessageId ? feedbackMap.get(message.sourceMessageId) : undefined" :tickets="tickets" :touch="touchWorkspace" :on-load-process="loadProcess" @stop="stop" />
                <div v-if="message.workerEvent === 'result' && (message.truncated || message.unboundedOutcome) && message.sessionId" class="mt-1 text-xs">
                  <RouterLink :to="sessionRoute(message.sessionId)" data-open-full-worker class="inline-flex items-center text-ui-accent no-underline hover:underline">{{ t('superAgent.openSession') }}</RouterLink>
                </div>
                <details v-if="message.context" class="mt-1 break-words text-xs text-ui-text-muted">
                  <summary class="cursor-pointer">{{ message.sourceWorkspaceId === undefined ? t('superAgent.context') : t('superAgent.fromWorkspace', { name: conversationName(message.sourceWorkspaceId) }) }}</summary>
                  <p class="my-1 select-text whitespace-pre-wrap">{{ message.context }}</p>
                </details>
                <ul v-if="jobs.length > 1" class="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-xs text-ui-text-muted">
                  <li v-for="job in jobs" :key="job.ticket.id" class="flex flex-wrap items-center gap-x-2">
                    <span>{{ job.ticket.title }}</span>
                    <span v-if="job.delivery && (workerFailure || message.state === 'uncertain')">{{ missingWorker(job.delivery) ? t('superAgent.actions.workerNotStarted') : job.delivery.text }}</span>
                    <UiButton size="icon" variant="ghost" :label="t('superAgent.actions.quoteTicket', { name: job.ticket.title })" @click="quote(job.marker)"><CornerUpLeft :size="13" aria-hidden="true" /></UiButton>
                  </li>
                </ul>
                <div v-if="workerFailure && !perTicketFailures" class="mt-1 text-xs text-ui-text-muted" role="status">
                  {{ workerMissing ? t('superAgent.actions.workerNotStarted') : t('superAgent.actions.workerFailed') }}<template v-if="!workerMissing && message.reason"> {{ message.reason }}</template>
                </div>
                <div v-else-if="message.failureCode === 'coordinator_unconfigured'" class="mt-1 text-xs text-ui-text-muted" role="status">{{ t('superAgent.coordinatorUnavailable') }}</div>
                <div v-else-if="!workerFailure && (message.state === 'uncertain' || message.state === 'failed')" class="mt-1 text-xs text-ui-text-muted" role="status">{{ t(`superAgent.state.${message.state}`) }}<template v-if="message.reason && !(message.state === 'uncertain' && perTicketFailures)"> {{ message.reason }}</template></div>
                <div v-if="workerMissing || message.retryable || message.targetWorkspaceId" :class="touchWorkspace && 'workspace-touch-actions'" class="mt-1 flex flex-wrap items-center gap-3 text-xs text-ui-text-muted">
                  <button v-if="workerMissing && workers.length" type="button" class="text-ui-accent" @click="showSettings = true">{{ t('superAgent.actions.chooseWorker') }}</button>
                  <RouterLink v-else-if="workerMissing" :to="{ name: 'settings-agents' }" class="text-ui-accent">{{ t('superAgent.actions.configureWorker') }}</RouterLink>
                  <button v-else-if="message.role === 'user' && message.retryable && !workerFailure" type="button" class="hover:text-ui-accent" @click="showSettings = true">{{ t('superAgent.switchHint') }}</button>
                  <button v-if="message.role === 'user' && message.retryable" type="button" :disabled="busy || (workerMissing && !workers.length)" class="text-ui-accent disabled:text-ui-text-muted" @click="retry(message)">{{ t(workerFailure ? 'superAgent.actions.retryWorker' : 'errors.retry') }}</button>
                  <button v-if="message.targetWorkspaceId" type="button" class="inline-flex items-center gap-1 text-ui-accent" @click="goToProject(message.targetWorkspaceId)">{{ t('superAgent.openWorkspace', { name: workspaceName(message.targetWorkspaceId) }) }}<ArrowRight :size="12" aria-hidden="true" /></button>
                  <RouterLink v-if="message.provenance?.scheduleId" :to="scheduleRoute(message.provenance.scheduleId)" data-message-open-schedule class="inline-flex items-center text-ui-accent no-underline hover:underline">{{ t('superAgent.followUp.openSchedule') }}</RouterLink>
                  <RouterLink v-if="message.provenance?.sessionId && message.provenance.evidenceAvailability !== 'deleted'" :to="sessionRoute(message.provenance.sessionId)" data-message-open-session class="inline-flex items-center text-ui-accent no-underline hover:underline">{{ t('superAgent.openSession') }}</RouterLink>
                </div>
                <div v-else-if="message.provenance?.scheduleId || message.provenance?.sessionId" :class="touchWorkspace && 'workspace-touch-actions'" class="mt-1 flex flex-wrap items-center gap-3 text-xs text-ui-text-muted">
                  <span v-if="message.provenance.scheduleTitle">{{ t(message.provenance.sourceKind === 'schedule' ? 'superAgent.followUp.fromSchedule' : 'superAgent.followUp.fromSession', { title: message.provenance.scheduleTitle }) }}</span>
                  <RouterLink v-if="message.provenance.scheduleId" :to="scheduleRoute(message.provenance.scheduleId)" data-message-open-schedule class="inline-flex items-center text-ui-accent no-underline hover:underline">{{ t('superAgent.followUp.openSchedule') }}</RouterLink>
                  <RouterLink v-if="message.provenance.sessionId && message.provenance.evidenceAvailability !== 'deleted'" :to="sessionRoute(message.provenance.sessionId)" data-message-open-session class="inline-flex items-center text-ui-accent no-underline hover:underline">{{ t('superAgent.openSession') }}</RouterLink>
                  <span v-if="message.provenance.evidenceAvailability && message.provenance.evidenceAvailability !== 'available'">{{ t(message.provenance.evidenceAvailability === 'archived' ? 'superAgent.followUp.evidenceArchived' : message.provenance.evidenceAvailability === 'deleted' ? 'superAgent.followUp.evidenceDeleted' : message.provenance.evidenceAvailability === 'partial' ? 'superAgent.followUp.evidencePartial' : 'superAgent.followUp.evidenceRestricted') }}</span>
                </div>
              </WorkspaceMessage>
            </li>
            <li
              v-if="message.role === 'user' && (progress || feedback?.ack || feedback?.milestones.length || feedback?.finalPreviews.length || (feedback?.hasProcess && !activeProgressSources.has(message.id)))"
              :data-feedback-group-for="message.id"
              :data-outline-source="message.id"
              :aria-label="t('superAgent.role.assistant')"
              class="mr-auto flex min-w-0 max-w-full flex-col gap-2"
              :class="{ 'workspace-touch-actions': touchWorkspace }"
            >
              <div v-if="progress || feedback?.ack || feedback?.milestones.length || feedback?.finalPreviews.length" class="text-xs text-ui-text-muted">{{ t("superAgent.role.assistant") }}</div>
              <div v-if="feedback?.ack" :data-feedback-ack="feedback.ack.itemId" class="group flex min-w-0 flex-col items-start gap-1.5">
                <AgentContent class="max-w-full" :content="[{ type: 'text', text: feedback.ack.text }]" markdown :final="feedback.ack.status !== 'streaming'" />
                <AgentMessageActions :text="feedback.ack.text" :always-visible="touchWorkspace" can-quote @quote="quote({ id: feedback.ack.itemId })" />
              </div>
              <div
                v-for="milestone in feedback?.milestones ?? []"
                :key="milestone.itemId"
                :data-feedback-milestone="milestone.itemId"
                :data-feedback-status="milestone.status"
                class="group flex min-w-0 flex-col items-start gap-1.5 border-l-2 border-ui-border pl-3"
              >
                <div class="flex flex-wrap items-center gap-2 text-xs text-ui-text-muted">
                  <span>{{ t("superAgent.feedback.milestone") }}</span>
                  <span v-if="milestone.ticketId && tickets.get(milestone.ticketId)">· {{ tickets.get(milestone.ticketId)!.title }}</span>
                  <RouterLink v-if="milestone.sessionId" :to="sessionRoute(milestone.sessionId)" class="text-ui-accent no-underline hover:underline">{{ t("superAgent.openSession") }}</RouterLink>
                </div>
                <AgentContent class="max-w-full" :content="[{ type: 'text', text: milestone.text }]" markdown :final="milestone.status !== 'streaming'" />
                <p v-if="milestone.status === 'aborted'" data-milestone-aborted role="status" class="m-0 text-xs text-ui-text-muted">{{ t("superAgent.feedback.draftAborted") }}</p>
                <AgentMessageActions :text="milestone.text" :always-visible="touchWorkspace" can-quote @quote="quote({ id: milestone.itemId })" />
              </div>
              <div
                v-for="preview in feedback?.finalPreviews ?? []"
                :key="preview.itemId"
                :data-feedback-final-preview="preview.itemId"
                :data-feedback-status="preview.status"
                class="flex min-w-0 flex-col items-start gap-1.5"
              >
                <AgentContent class="max-w-full" :content="[{ type: 'text', text: preview.text }]" markdown :final="preview.status !== 'streaming'" />
                <p v-if="preview.status === 'aborted'" data-draft-aborted role="status" class="m-0 text-xs text-ui-text-muted">{{ t("superAgent.feedback.draftAborted") }}</p>
                <p v-if="preview.truncated" data-excerpt-notice class="m-0 text-xs text-ui-text-muted">{{ t("superAgent.feedback.excerptNotice") }}</p>
                <RouterLink v-if="(preview.truncated || preview.status === 'aborted') && preview.sessionId" :to="sessionRoute(preview.sessionId)" class="text-xs text-ui-accent no-underline hover:underline">{{ t("superAgent.openSession") }}</RouterLink>
              </div>
              <WorkspaceReplyProgress
                v-if="progress"
                :progress="progress"
                :supports-stop="supportsStop"
                :disabled="stopDisabled"
                :unreachable="stopUnreachable"
                :feedback="feedback"
                :tickets="tickets"
                :touch="touchWorkspace"
                :on-load-process="loadProcess"
                @stop="stop"
              />
              <WorkspaceProgressDetails
                v-else-if="feedback?.hasProcess && !activeProgressSources.has(message.id)"
                :feedback="feedback"
                :active="false"
                :tickets="tickets"
                :touch="touchWorkspace"
                :on-load="loadProcess"
              />
            </li>
          </template>
          </template>
        </ol>
      </div>
    </UiScrollArea>
    <ReadingSpotlight />
    <AgentOutline v-if="outline.length" :entries="outline" :active="activeEntry" class="absolute left-1 top-1/2 z-20 max-h-[calc(100%-2rem)] -translate-y-1/2" @select="locateEntry" />
    <div v-if="snapshot && !stickToBottom" class="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
      <div class="relative mx-auto flex w-full max-w-3xl justify-end px-6">
        <UiButton type="button" size="icon" class="pointer-events-auto h-8 w-8 rounded-full border border-ui-border bg-ui-surface text-ui-text shadow-ui-popover" :label="t('agent.scrollToBottom')" data-scroll-to-bottom @click="scrollToBottom">
          <ArrowDown :size="16" :stroke-width="1.75" aria-hidden="true" />
        </UiButton>
      </div>
    </div>
  </div>
  <div v-if="snapshot?.pendingRequests?.length" class="mx-auto flex max-h-[36dvh] w-full max-w-3xl shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain px-6 py-2" :aria-label="t('agent.permissions')" role="region">
    <WorkspaceWorkerRequest v-for="request in snapshot.pendingRequests" :key="requestKey(request)"
      :request="request" :title="tickets.get(request.ticketId)?.title ?? request.sourceTitle" :disabled="!!offlineMachine || machinePresence?.online === false || canRefresh" @refresh="refresh" />
  </div>
  <div v-if="offlineMachine || error || unsupportedAttachments || missingAttachments.length" class="mx-auto w-full max-w-3xl shrink-0 px-6 pt-2">
    <p v-if="unsupportedAttachments" role="alert" class="mb-2 text-sm text-ui-danger">{{ t('superAgent.attachmentsUnsupported') }}</p>
    <div v-if="missingAttachments.length" role="alert" class="mb-2 text-sm text-ui-text-muted">
      <p>{{ t('superAgent.reselectAttachments') }}</p>
      <button v-for="file in missingAttachments" :key="file.id" type="button" class="mr-2 inline-flex items-center gap-1" :aria-label="t('composer.removeAttachment', { name: file.name ?? t('composer.pastedText') })" @click="discardMissing(file.id)">{{ file.name ?? t('composer.pastedText') }}<X :size="14" aria-hidden="true" /></button>
    </div>
    <p v-if="offlineMachine" role="status" class="mb-2 break-words text-sm text-ui-text-muted">{{ t('desktop.offline', { machine: offlineMachine.name }) }}</p>
    <p v-else-if="error" role="alert" class="mb-2 break-words text-sm text-ui-danger">{{ error }} <button v-if="canRefresh" type="button" class="text-ui-accent" @click="refresh">{{ t('errors.retry') }}</button><button v-if="canSendPlain" type="button" class="text-ui-accent" @click="send(true)">{{ t('superAgent.commands.sendText') }}</button></p>
  </div>
  <UiDialog v-if="choosingStop && stopChoices.length" v-slot="{ close }" :title="t('superAgent.stop.choose')" class="w-[26rem] max-w-[90vw] p-4" @close="choosingStop = false">
    <h2 class="mb-2 font-medium">{{ t('superAgent.stop.choose') }}</h2>
    <button v-for="choice in stopChoices" :key="choice.sourceId" type="button" :disabled="stopDisabled" class="ui-menu-item min-h-11 w-full justify-start" @click="close(); stop(choice)">
      <span class="min-w-0 truncate">{{ quoteText(byId.get(choice.sourceId)!) }}</span>
      <span v-if="stoppableSteps(choice).length > 1 || stoppableSteps(choice)[0]?.sharedTurn" class="shrink-0 text-xs">{{ stopLabel(choice) }}</span>
    </button>
    <UiButton variant="ghost" size="sm" @click="close">{{ t('catalog.cancel') }}</UiButton>
  </UiDialog>
  <SessionComposer ref="editor" v-model="draft.text" v-model:attachments="attachments" v-model:mentions="mentions" :workspace-agent="commandMenu" :location="location" :coordinator-usage="snapshot?.coordinatorUsage" :disabled="!snapshot || saving" :submitting="sending" :submit-blocked="!!offlineMachine || draft.text.trim() === '/' || unsupportedAttachments || !!missingAttachments.length" :can-cancel="!!stopChoices.length && !stopDisabled" :cancel-label="cancelLabel" @cancel="composerStop" @submit="submit">
    <template #before-input>
      <div v-if="quoted" class="mx-3 mt-3 flex items-center gap-2 border-l-2 border-ui-accent pl-2 text-xs text-ui-text-muted">
        <span class="min-w-0 flex-1 truncate">{{ quoteText(quoted) }}</span>
        <button type="button" :aria-label="t('superAgent.clearQuote')" @click="delete draft.replyTo"><X :size="14" aria-hidden="true" /></button>
      </div>
    </template>
    <template #toolbar>
      <ProjectModelMenu v-if="snapshot" v-model:open="showSettings" :touch="touchWorkspace" :save-error="error" :snapshot="snapshot" :workers="workers" :disabled="busy" :save="saveSettings" @refresh="refresh" />
    </template>
  </SessionComposer>
</template>

<style scoped>
.workspace-touch-actions :deep(button),
.workspace-touch-actions :deep(a) { min-height: 44px; min-width: 44px; }
.ui-conversation-history {
  content-visibility: auto;
  contain-intrinsic-block-size: auto 24rem;
}
.ui-conversation-history.ui-conversation-input {
  contain-intrinsic-block-size: auto 5rem;
}
@media print {
  .ui-conversation-history { content-visibility: visible; }
}
</style>
