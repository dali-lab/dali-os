// Bookmark/embed custom block (React spec over the shared embedConfig).
//
// Renders a block-level link card. Empty (freshly inserted) blocks show a URL
// input; once a URL is set the card is a clickable link showing the domain +
// URL (+ an optional user caption). No external requests — there is no
// third-party unfurl call (and no SSRF surface). The server codec in
// app/collab/blocknote-server.ts renders the same card to HTML for export /
// version history.

import { createReactBlockSpec } from "@blocknote/react";
import { Globe } from "lucide-react";
import { useState } from "react";
import { embedConfig } from "./configs";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const createEmbedBlock = createReactBlockSpec(embedConfig, {
  render: (props) => {
    const { url, title } = props.block.props;
    const editable = props.editor.isEditable;

    if (!url) {
      if (!editable) {
        return (
          <div className="dali-embed dali-embed--empty" contentEditable={false}>
            Empty bookmark
          </div>
        );
      }
      return (
        <EmbedInput
          onSubmit={(next) => props.editor.updateBlock(props.block, { props: { url: next } })}
        />
      );
    }

    const domain = domainOf(url);
    return (
      <a
        className="dali-embed dali-embed--card"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        contentEditable={false}
      >
        <span className="dali-embed__icon" aria-hidden>
          <Globe className="w-4 h-4" />
        </span>
        <span className="dali-embed__meta">
          <span className="dali-embed__title">{title || domain}</span>
          <span className="dali-embed__url">{url}</span>
        </span>
      </a>
    );
  },
});

function EmbedInput({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const next = normalizeUrl(draft);
    if (next) onSubmit(next);
  };
  return (
    <div className="dali-embed dali-embed--input" contentEditable={false}>
      <Globe className="w-4 h-4 shrink-0" aria-hidden />
      <input
        className="dali-embed__field"
        placeholder="Paste a link and press Enter…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="dali-embed__add"
        onMouseDown={(e) => e.preventDefault()}
        onClick={submit}
      >
        Add
      </button>
    </div>
  );
}

export const EmbedSpec = createEmbedBlock();
