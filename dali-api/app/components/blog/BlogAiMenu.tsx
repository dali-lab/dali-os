import { useState } from "react";
import { Languages, PenLine, Sparkles, SpellCheck, Undo2, Wand2 } from "lucide-react";
import type { DocBlock, DocEditorInstance } from "~/components/doc/schema/build";
import { appendBlocks } from "~/components/doc/insert";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import type { WritingTask } from "~/email/lib/ai-prompts";
import { aiPassages } from "~/lib/blog-ai";

const DRAFT_CONTEXT_CHARS = 6000;
const FAILED = "AI couldn't help with that one.";

async function ask(body: Record<string, string>): Promise<string> {
  const res = await fetch("/api/ai/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, surface: "post" }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok || !data.text) throw new Error(data.error ?? FAILED);
  return data.text;
}

// The Email tab's AI tools, on a whole post: write more, rephrase, proofread,
// translate. Rewrites go a passage at a time (see aiPassages).
export function BlogAiMenu({ editor }: { editor: DocEditorInstance | null }) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<DocBlock[] | null>(null);

  const run = async (task: WritingTask) => {
    if (!editor) return;
    let instruction = "";
    let language = "";
    if (task === "draft" || task === "rephrase") {
      const value = await dialog.prompt({
        title: task === "draft" ? "Write with AI" : "Rephrase",
        label: task === "draft" ? "What should it write?" : "How should it change? (optional)",
        placeholder: task === "draft" ? "An intro about our fall demo night" : "Shorter and warmer",
        confirmLabel: task === "draft" ? "Write" : "Rephrase",
        validate: (v) => (task === "draft" && !v.trim() ? "Say what to write" : null),
      });
      if (value === null) return;
      instruction = value;
    }
    if (task === "translate") {
      const value = await dialog.prompt({
        title: "Translate",
        label: "Into which language?",
        placeholder: "Spanish",
        confirmLabel: "Translate",
        validate: (v) => (v.trim() ? null : "Enter a language"),
      });
      if (value === null) return;
      language = value;
    }

    const before = editor.document;
    let changed = false;
    setBusy(true);
    try {
      if (task === "draft") {
        const soFar = await editor.blocksToMarkdownLossy(before);
        const text = await ask({ task, instruction, text: soFar.slice(-DRAFT_CONTEXT_CHARS) });
        appendBlocks(editor, await editor.tryParseMarkdownToBlocks(text));
        changed = true;
      } else {
        const passages = aiPassages(before);
        if (passages.length === 0) {
          toast.info("Write something first.");
          return;
        }
        for (const ids of passages) {
          const blocks = ids.map((id) => editor.getBlock(id)).filter((b) => b !== undefined);
          // Someone removed part of it while the last passage was out.
          if (blocks.length !== ids.length) continue;
          const text = await ask({
            task,
            instruction,
            language,
            text: await editor.blocksToMarkdownLossy(blocks),
          });
          editor.replaceBlocks(blocks, await editor.tryParseMarkdownToBlocks(text));
          changed = true;
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : FAILED);
    } finally {
      if (changed) setUndo(before);
      setBusy(false);
    }
  };

  return (
    <>
      <Menu
        ariaLabel="AI tools"
        trigger={
          <button
            type="button"
            disabled={busy || !editor}
            className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1.5 text-xs font-medium text-foreground hover:bg-os-container-hi disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {busy ? "Working…" : "AI tools"}
          </button>
        }
      >
        <MenuItem icon={<PenLine className="h-4 w-4" />} onSelect={() => run("draft")}>
          Write with AI
        </MenuItem>
        <MenuItem icon={<Wand2 className="h-4 w-4" />} onSelect={() => run("rephrase")}>
          Rephrase
        </MenuItem>
        <MenuItem icon={<SpellCheck className="h-4 w-4" />} onSelect={() => run("proofread")}>
          Proofread
        </MenuItem>
        <MenuItem icon={<Languages className="h-4 w-4" />} onSelect={() => run("translate")}>
          Translate
        </MenuItem>
      </Menu>
      {undo && !busy && (
        <IconButton
          label="Undo AI change"
          icon={Undo2}
          onClick={() => {
            editor?.replaceBlocks(editor.document, undo);
            setUndo(null);
          }}
        />
      )}
    </>
  );
}
