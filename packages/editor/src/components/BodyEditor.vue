<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, keymap } from '@codemirror/view';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { PERSON_FORMS, parseForm, slotTokens } from '@ed/schema';

/**
 * THE BODY EDITOR (issue #21). CodeMirror is a new dependency — the house
 * style otherwise hand-rolls (`FamilyTree.vue`, `Sigil.vue`) — but the issue
 * itself judged it worth a second look for twenty-seven events and one
 * author, and a text editor is exactly the thing not worth re-inventing.
 *
 * Three live decorations over the plain prose:
 *   defined slot token     a filled chip — `{CHALLENGER}`, `{CHALLENGER.their}`
 *   undefined slot token    underlined in the error colour, live — an
 *                           unknown form (`{CHALLENGER.thier}`) too
 *   `{`                     opens autocomplete over the event's own slots,
 *                           and `{SLOT.` over the forms (`forms.ts`)
 *
 * `{` in a TEMPLATE LITERAL collides with Vue's `{{ }}` (AGENTS.md's own
 * warning) — every string built here lives in `<script>`, never inlined in
 * the template.
 */
const props = defineProps<{ modelValue: string; slotNames: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

// The known-slots set is read by the decoration builder below, which is
// itself re-created (via a StateEffect) whenever the event changes slots.
let knownSlots = new Set(props.slotNames);
const setSlots = StateEffect.define<Set<string>>();

const slotField = StateField.define<Set<string>>({
  create: () => knownSlots,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSlots)) return e.value;
    return value;
  },
});

function buildDecorations(view: EditorView): DecorationSet {
  const slots = view.state.field(slotField);
  const marks: ReturnType<typeof Decoration.mark>[] = [];
  const ranges: { from: number; to: number; deco: ReturnType<typeof Decoration.mark> }[] = [];
  const text = view.state.doc.toString();
  for (const t of slotTokens(text)) {
    const from = t.index;
    const to = from + t.raw.length;
    const known = slots.has(t.slot) && (t.form === undefined || parseForm(t.form) !== undefined);
    ranges.push({
      from, to,
      deco: Decoration.mark({ class: known ? 'cm-slot-token' : 'cm-slot-undefined' }),
    });
  }
  void marks;
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
}

const slotHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) { this.decorations = buildDecorations(v); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSlots)))) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

/** Autocomplete: typing `{` offers the event's own slot names. */
function slotCompletions(context: CompletionContext): CompletionResult | null {
  const form = context.matchBefore(/\{[A-Z_][A-Z0-9_]*\.[A-Za-z]*/);
  if (form) {
    const slot = form.text.slice(1, form.text.indexOf('.'));
    return {
      from: form.from,
      options: PERSON_FORMS.map((f) => ({ label: `{${slot}.${f}}`, type: 'keyword', apply: `{${slot}.${f}}` })),
      validFor: /^\{[A-Z_][A-Z0-9_]*\.[A-Za-z]*$/,
    };
  }
  const word = context.matchBefore(/\{[A-Z_]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: knownSlots.size
      ? [...knownSlots].map((s) => ({ label: `{${s}}`, type: 'variable', apply: `{${s}}` }))
      : [{ label: '{no slots declared}', apply: '' }],
    validFor: /^\{[A-Z_]*$/,
  };
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([]),
        slotField,
        slotHighlighter,
        autocompletion({ override: [slotCompletions] }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
        }),
        EditorView.theme({
          '&': { fontSize: '14px', border: '1px solid var(--rule)', borderRadius: '3px', background: 'var(--vellum)' },
          '.cm-content': { fontFamily: 'inherit', lineHeight: '1.6', padding: '8px 0' },
          '.cm-slot-token': { background: 'color-mix(in srgb, var(--uncommon) 22%, transparent)', borderRadius: '3px' },
          '.cm-slot-undefined': { textDecoration: 'underline wavy var(--rubric)', textUnderlineOffset: '3px' },
        }),
      ],
    }),
    parent: host.value,
  });
});

onBeforeUnmount(() => view?.destroy());

// External changes (switching to a different event) replace the whole doc.
watch(() => props.modelValue, (next) => {
  if (!view) return;
  const current = view.state.doc.toString();
  if (next !== current) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
  }
});

// The slot list changes per-event too — feed it through a StateEffect rather
// than tearing the view down, so cursor position and undo history survive.
watch(() => props.slotNames, (next) => {
  knownSlots = new Set(next);
  view?.dispatch({ effects: setSlots.of(knownSlots) });
}, { deep: true });
</script>

<template>
  <div ref="host" />
</template>
