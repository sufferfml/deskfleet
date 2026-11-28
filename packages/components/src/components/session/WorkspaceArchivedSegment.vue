<script setup lang="ts">
import { ChevronRight } from "@lucide/vue"
import { computed, useId } from "vue"
import { useI18n } from "vue-i18n"
import { isValidAccentSlot, type SuperTicket } from "@deskfleet/protocol/super-agent"
import "../../styles/sa-ticket-accents.css"

const props = defineProps<{
  segmentId: string
  tickets: readonly SuperTicket[]
  messageCount: number
  expanded: boolean
  touch?: boolean
}>()

const emit = defineEmits<{ toggle: [segmentId: string] }>()
const { t } = useI18n()
const panelId = `sa-archived-panel-${useId()}`

function accentSlotOf(ticket?: SuperTicket): number | undefined {
  return ticket && isValidAccentSlot(ticket.accentSlot) ? ticket.accentSlot : undefined
}

function ticketLabel(ticket: SuperTicket): string {
  const title = ticket.title.trim()
  return title || t("superAgent.archivedFold.untitled")
}

const singleAccentSlot = computed(() =>
  props.tickets.length === 1 ? accentSlotOf(props.tickets[0]) : undefined,
)

const fullTitle = computed(() => props.tickets.map(ticketLabel).join(" / "))
</script>

<template>
  <li
    :data-archived-segment="segmentId"
    :data-archived-expanded="expanded ? 'true' : 'false'"
    :data-archived-ticket-ids="tickets.map(ticket => ticket.id).join(',')"
    :data-sa-accent-slot="singleAccentSlot"
    :class="singleAccentSlot !== undefined && 'sa-ticket-accent'"
    class="sa-archived-segment min-w-0"
  >
    <button
      type="button"
      data-archived-segment-toggle
      :aria-expanded="expanded"
      :aria-controls="expanded ? panelId : undefined"
      :title="fullTitle"
      :class="[
        'sa-archived-bar ui-motion',
        expanded && 'sa-archived-bar-expanded',
        touch && 'min-h-11 py-2',
      ]"
      @click="emit('toggle', segmentId)"
    >
      <span class="sa-archived-meta flex min-w-0 flex-1 items-center gap-1.5">
        <ChevronRight
          :size="14"
          aria-hidden="true"
          class="sa-archived-chevron shrink-0 ui-motion"
          :class="expanded && 'rotate-90'"
        />
        <span data-archived-segment-badge class="shrink-0 whitespace-nowrap">{{ t("superAgent.archivedFold.badge") }}</span>
        <span aria-hidden="true" class="sa-archived-sep shrink-0">·</span>
        <span data-archived-segment-title class="min-w-0 truncate">
          <template v-for="(ticket, idx) in tickets" :key="ticket.id">
            <span v-if="idx > 0" aria-hidden="true" class="sa-archived-sep"> / </span>
            <span
              data-archived-ticket-name
              :data-sa-ticket-id="ticket.id"
              :data-sa-accent-slot="accentSlotOf(ticket)"
              :class="[
                'sa-archived-ticket-name',
                accentSlotOf(ticket) !== undefined && 'sa-ticket-accent',
              ]"
            >{{ ticketLabel(ticket) }}</span>
          </template>
        </span>
        <span aria-hidden="true" class="sa-archived-sep shrink-0">·</span>
        <span data-archived-segment-count class="shrink-0 whitespace-nowrap">
          {{ t("superAgent.archivedFold.messageCount", { count: messageCount }, messageCount) }}
        </span>
      </span>
      <span data-archived-segment-action class="sa-archived-action shrink-0 whitespace-nowrap">
        {{ t(expanded ? "superAgent.archivedFold.collapse" : "superAgent.archivedFold.expand") }}
      </span>
    </button>
    <ol
      v-if="expanded"
      :id="panelId"
      data-archived-segment-content
      role="list"
      class="sa-archived-content mt-3 flex flex-col gap-6"
    >
      <slot />
    </ol>
  </li>
</template>

<style scoped>
.sa-archived-segment {
  container-type: inline-size;
  /* Derive muted archived tones from untouched theme tokens (no container opacity, no CSS var cycle). */
  --sa-arch-body: color-mix(in oklab, var(--ui-color-text) 74%, var(--ui-color-canvas) 26%);
  --sa-arch-meta: color-mix(in oklab, var(--ui-color-text-muted) 88%, var(--ui-color-canvas) 12%);
  --sa-arch-faint: color-mix(in oklab, var(--ui-color-text-faint) 76%, var(--ui-color-canvas) 24%);
  --sa-arch-link: color-mix(in oklab, var(--ui-color-accent) 56%, var(--ui-color-text-muted) 44%);
  --sa-arch-link-hover: color-mix(in oklab, var(--ui-color-accent) 78%, var(--ui-color-text) 22%);
  --sa-arch-bubble-bg: color-mix(in oklab, var(--ui-color-text) 3.5%, var(--ui-color-canvas) 96.5%);
  --sa-arch-surface: color-mix(in oklab, var(--ui-color-surface) 45%, var(--ui-color-canvas) 55%);
  --sa-arch-badge: color-mix(in oklab, var(--ui-color-text) 4%, var(--ui-color-canvas) 96%);
  --sa-arch-border: color-mix(in oklab, var(--ui-color-border) 58%, var(--ui-color-canvas) 42%);
  --sa-arch-rail: color-mix(in oklab, var(--ui-color-border-strong) 50%, var(--ui-color-canvas) 50%);
  --sa-arch-icon: color-mix(in oklab, var(--ui-color-text-muted) 56%, var(--ui-color-canvas) 44%);
  --sa-arch-avatar-bg: color-mix(in oklab, var(--ui-color-text-muted) 15%, var(--ui-color-canvas) 85%);
  --sa-arch-avatar-text: var(--sa-arch-meta);
  --sa-arch-hover-text: var(--ui-color-text);
  --sa-arch-focus: var(--ui-color-focus);
}

.sa-archived-bar {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0.125rem;
  border: 0;
  border-radius: 0.375rem;
  background-color: transparent;
  color: var(--ui-color-text-muted);
  font-size: 0.8125rem;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.sa-archived-bar.sa-archived-bar-expanded {
  border: 0;
  background-color: transparent;
}

@container (max-width: 22rem) {
  .sa-archived-bar {
    gap: 0.375rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
  }

  .sa-archived-meta {
    gap: 0.25rem;
  }
}

/* Only the ticket title retains a light hint of its original accent; badge, count, chevron, and action stay neutral gray. */
.sa-archived-chevron {
  color: var(--ui-color-text-muted);
}

.sa-archived-sep {
  color: var(--ui-color-text-faint);
}

.sa-archived-ticket-name {
  color: color-mix(in oklab, var(--ui-color-text-muted) 72%, var(--sa-accent-text, var(--ui-color-text-muted)) 28%);
  font-weight: 500;
}

.sa-archived-action {
  color: var(--ui-color-text-muted);
  font-weight: 500;
}

@media (hover: hover) {
  .sa-archived-bar:hover {
    background-color: transparent;
  }

  .sa-archived-bar:hover .sa-archived-chevron {
    color: var(--ui-color-text);
  }

  .sa-archived-bar:hover .sa-archived-action {
    color: var(--ui-color-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
}

.sa-archived-bar:focus-visible {
  outline: 2px solid var(--sa-arch-focus);
  outline-offset: 2px;
}

.sa-archived-bar:focus-visible .sa-archived-action {
  color: var(--ui-color-text);
}

/* Expanded archived history stays secondary without setting opacity on the container. */
.sa-archived-content {
  margin-left: 0.625rem;
  padding-left: 0.875rem;
  border-left: 2px solid var(--sa-arch-rail);
  color: var(--sa-arch-body);
  --ui-color-text: var(--sa-arch-body);
  --ui-color-text-muted: var(--sa-arch-meta);
  --ui-color-text-faint: var(--sa-arch-faint);
  --ui-color-accent: var(--sa-arch-link);
  --ui-color-surface: var(--sa-arch-surface);
  --ui-color-badge: var(--sa-arch-badge);
  --ui-color-border: var(--sa-arch-border);
  --ui-color-border-strong: var(--sa-arch-border);
  --ui-color-avatar: var(--sa-arch-avatar-bg);
  --ui-color-avatar-text: var(--sa-arch-avatar-text);
}

/* Prevent the segment wrapper's ticket accent variables from leaking into unattributed nested content. */
.sa-archived-content > :deep(*) {
  --sa-accent-text: initial;
  --sa-accent-rail: initial;
}

/* Soften bubbles, speaker metadata, icons, and nested ticket chrome more than body prose. */
.sa-archived-content :deep([data-user-message-bubble]) {
  background-color: var(--sa-arch-bubble-bg);
}

.sa-archived-content :deep([data-user-message-meta]) {
  color: var(--sa-arch-meta);
}

.sa-archived-content :deep([data-user-message-meta] .text-ui-text) {
  color: var(--sa-arch-meta);
}

.sa-archived-content :deep([data-user-message-meta] svg:not(.text-ui-warning)) {
  color: var(--sa-arch-icon);
}

.sa-archived-content :deep([data-execution-toggle] svg),
.sa-archived-content :deep(.ui-button-ghost svg) {
  color: var(--sa-arch-icon);
}

.sa-archived-content :deep(.sa-ticket-label) {
  color: color-mix(in oklab, var(--sa-arch-meta) 72%, var(--sa-accent-text, var(--sa-arch-meta)) 28%);
}

.sa-archived-content :deep(.sa-ticket-dot) {
  color: color-mix(in oklab, var(--sa-arch-rail) 62%, var(--sa-accent-text, var(--sa-arch-rail)) 38%);
}

.sa-archived-content :deep(.sa-ticket-rail) {
  border-left-color: color-mix(in oklab, var(--sa-arch-rail) 74%, var(--sa-accent-rail, var(--sa-arch-rail)) 26%);
}

/* Preserve visible link underlines and crisp keyboard focus rings; hover only emphasizes the active control. */
.sa-archived-content :deep(a) {
  color: var(--sa-arch-link);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, currentColor 65%, transparent);
  text-underline-offset: 2px;
}

@media (hover: hover) {
  .sa-archived-content :deep(a:hover) {
    color: var(--sa-arch-link-hover);
    text-decoration-color: currentColor;
  }

  .sa-archived-content :deep([data-execution-toggle]:hover) {
    color: var(--sa-arch-hover-text);
  }

  .sa-archived-content :deep([data-execution-toggle]:hover svg),
  .sa-archived-content :deep(.ui-button-ghost:hover svg) {
    color: var(--sa-arch-hover-text);
  }
}

.sa-archived-content :deep(:focus-visible) {
  outline: 2px solid var(--sa-arch-focus);
  outline-offset: 2px;
}

@media (pointer: coarse) {
  .sa-archived-bar {
    min-height: 2.75rem;
    padding-block: 0.5rem;
  }
}

@media (forced-colors: active) {
  .sa-archived-bar {
    background-color: transparent;
    color: ButtonText;
  }

  .sa-archived-chevron,
  .sa-archived-ticket-name,
  .sa-archived-action {
    color: ButtonText;
  }

  .sa-archived-content {
    border-left-color: CanvasText;
    color: CanvasText;
  }

  .sa-archived-content :deep(a) {
    color: LinkText;
  }
}
</style>
