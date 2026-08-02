// Callout custom block (React spec over the shared calloutConfig).
//
// Representation (settled in the spike): content is INLINE; additional
// paragraphs live as generic nested children (blockContainer > blockGroup)
// painted into the colored box via CSS — see the callout rules in ../theme.css.
// The emoji is a prop; clicking it cycles through a fixed set, and non-default
// values serialize to data-emoji on .bn-block-content, which drives the CSS
// tint variants.

import { createReactBlockSpec } from "@blocknote/react";
import { calloutConfig } from "./configs";

export const CALLOUT_EMOJI_CYCLE = ["💡", "🚨", "✅", "📌"] as const;

// 0.52.x: createReactBlockSpec returns a factory — call it to get the spec.
const createCalloutBlock = createReactBlockSpec(calloutConfig, {
  render: (props) => {
    const emoji = props.block.props.emoji;
    return (
      <div className="dali-callout">
        <span
          className="dali-callout__emoji"
          contentEditable={false}
          role="button"
          title="Change icon"
          onClick={() => {
            if (!props.editor.isEditable) return;
            const idx = (CALLOUT_EMOJI_CYCLE as readonly string[]).indexOf(emoji);
            const next = CALLOUT_EMOJI_CYCLE[(idx + 1) % CALLOUT_EMOJI_CYCLE.length];
            props.editor.updateBlock(props.block, { props: { emoji: next } });
          }}
        >
          {emoji}
        </span>
        {/* contentRef target becomes the editable .bn-inline-content */}
        <div className="dali-callout__body" ref={props.contentRef} />
      </div>
    );
  },
});

export const CalloutSpec = createCalloutBlock();
