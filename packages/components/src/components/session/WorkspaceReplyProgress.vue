<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { computed } from "vue"
import { Square } from "@lucide/vue"
import type { SuperTicket } from "@deskfleet/protocol/super-agent"
import type { WorkspaceRequestFeedback } from "../../services/workspace-feedback.ts"
import { stoppableSteps, type WorkspaceReplyProgress } from "../../services/workspace-message-timeline.ts"
import WorkspaceProgressDetails from "./WorkspaceProgressDetails.vue"

const props = defineProps<{
  progress: WorkspaceReplyProgress
  supportsStop?: boolean
  disabled?: boolean
  unreachable?: boolean
  feedback?: WorkspaceRequestFeedback
  tickets?: Map<string, SuperTicket>
  touch?: boolean
  onLoadProcess?: (sourceMessageId: string, append?: boolean) => void
}>()
const emit = defineEmits<{ stop: [progress: WorkspaceReplyProgress, ticketId?: string] }>()
const { t } = useI18n()
const targets = computed(() => props.supportsStop ? stoppableSteps(props.progress) : [])
const split = computed(() => targets.value.length > 1)
const label = computed(() => split.value ? t(targets.value.some(step => step.sharedTurn) ? "superAgent.stop.groupShared" : "superAgent.stop.group", { count: targets.value.length })
  : t(targets.value[0]?.sharedTurn ? "superAgent.stop.turn" : "superAgent.stop.request"))
</script>

<template>
  <div :data-agent-progress-for="progress.sourceId"
    class="my-1 border-l-2 border-ui-accent pl-2.5 text-sm leading-relaxed text-ui-text-muted">
    <div role="status" aria-atomic="true">
      <div v-for="(step, index) in progress.steps" :key="index">
        <template v-if="step.title">{{ step.title }} · </template>{{ t(`superAgent.progress.${step.state === "stopping" && unreachable ? "unconfirmed" : step.state}`) }}
        <button v-if="targets.length === 1 && targets[0] === step" type="button" class="ui-button-ghost ml-1 inline-flex min-h-7 items-center justify-center gap-1 px-1.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          :disabled="disabled" :title="label" :aria-label="label" @click="emit('stop', progress, step.ticketId)">
          <Square :size="11" fill="currentColor" aria-hidden="true" /><span v-if="step.sharedTurn">{{ label }}</span>
        </button>
      </div>
    </div>
    <template v-if="split">
      <button type="button" class="ui-button-ghost inline-flex min-h-7 items-center gap-1 px-1.5 [@media(pointer:coarse)]:min-h-11" :disabled="disabled" @click="emit('stop', progress)">
        <Square :size="11" fill="currentColor" aria-hidden="true" />{{ label }}
      </button>
      <details>
        <summary class="w-fit cursor-pointer py-1">{{ t("superAgent.stop.selectBranch") }}</summary>
        <button v-for="step in targets" :key="step.ticketId" type="button" class="ui-button-ghost block min-h-8 px-2 [@media(pointer:coarse)]:min-h-11" :disabled="disabled" @click="emit('stop', progress, step.ticketId)">
          {{ t(step.sharedTurn ? "superAgent.stop.namedTurn" : "superAgent.stop.named", { name: step.title }) }}
        </button>
      </details>
    </template>
    <WorkspaceProgressDetails v-if="feedback?.hasProcess" :feedback="feedback" :active="true" :tickets="tickets" :touch="touch" :on-load="onLoadProcess" />
  </div>
</template>
