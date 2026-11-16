// Image and video blocks, overridden so a link to a hosted video plays in its
// provider's player. A <video> can only play a media file, and the stock
// blocks' Embed tab accepts any URL. The props match the stock blocks, so stored
// documents are unchanged.
//
// Non-React, because the server schema uses these specs too. The server passes
// live: false to get a link in place of the iframe, since an iframe has no
// place in a PDF or the HTML sent to the public site.

import {
  createBlockSpec,
  createImageBlockConfig,
  createVideoBlockConfig,
  FILE_VIDEO_ICON_SVG,
  imageParse,
  imageRender,
  imageToExternalHTML,
  videoParse,
} from "@blocknote/core";
import { parseVideoEmbed, type VideoEmbed } from "~/lib/video-embed";
import { safeHref } from "../components/kinds";

interface MediaOptions {
  live?: boolean;
  /** Export hosted videos as an image, the one Markdown form that comes back as
   * a media block rather than a link, so a round trip keeps the player. */
  markdown?: boolean;
}

// imageRender is typed for the image block alone. The video block has the same
// props, so both go through these types.
type Render = ReturnType<typeof imageRender>;
type MediaBlock = Parameters<Render>[0];
type MediaEditor = Parameters<Render>[1];

const VIDEO_RENDER = imageRender({ icon: FILE_VIDEO_ICON_SVG });

// BlockNote doesn't export its resizable file wrapper, so reuse it through
// imageRender and swap the <img> out. The blank URL stops the <img> requesting
// a URL that isn't an image.
function renderInShell(block: MediaBlock, editor: MediaEditor, media: HTMLElement) {
  const shell = VIDEO_RENDER(
    { ...block, props: { ...block.props, url: "about:blank" } },
    editor,
  );
  shell.dom.querySelector("img")?.replaceWith(media);
  return shell;
}

function playerFrame(embed: VideoEmbed, block: MediaBlock): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.className = "bn-visual-media dali-video-embed";
  frame.src = embed.embedUrl;
  frame.title = block.props.caption || `${embed.provider} video`;
  frame.allow = "encrypted-media; picture-in-picture; fullscreen";
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("loading", "lazy");
  // YouTube refuses to play for an embedder that sends no referrer.
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  return frame;
}

function watchLink(url: string, embed: VideoEmbed): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = `Watch on ${embed.provider}`;
  return link;
}

function renderEmbed(
  block: MediaBlock,
  editor: MediaEditor,
  embed: VideoEmbed,
  { live }: MediaOptions,
) {
  if (!live) return { dom: watchLink(block.props.url, embed) };
  const shell = renderInShell(block, editor, playerFrame(embed, block));
  // The wrapper is fit-content, which is 0 wide around a percentage-width frame.
  if (!block.props.previewWidth) shell.dom.style.width = "100%";
  return shell;
}

function linkCard(block: MediaBlock, href: string): HTMLAnchorElement {
  const card = document.createElement("a");
  card.className = "dali-embed dali-embed--card";
  card.href = href;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.contentEditable = "false";
  const meta = document.createElement("span");
  meta.className = "dali-embed__meta";
  const title = document.createElement("span");
  title.className = "dali-embed__title";
  title.textContent = block.props.name || "Open video";
  const address = document.createElement("span");
  address.className = "dali-embed__url";
  address.textContent = block.props.url;
  meta.append(title, address);
  card.append(meta);
  return card;
}

function videoPlayer(block: MediaBlock): HTMLVideoElement {
  const video = document.createElement("video");
  video.className = "bn-visual-media";
  video.src = block.props.url;
  video.controls = true;
  video.contentEditable = "false";
  video.draggable = false;
  if (block.props.previewWidth) video.width = block.props.previewWidth;
  // A URL that turns out not to be a video would otherwise be a dead player.
  video.addEventListener("error", () => {
    const href = safeHref(block.props.url);
    if (href) video.replaceWith(linkCard(block, href));
  });
  return video;
}

function withCaption(element: HTMLElement, caption: string) {
  if (!caption) return { dom: element };
  const wrapper = document.createElement("div");
  const text = document.createElement("p");
  text.textContent = caption;
  wrapper.append(element, text);
  return { dom: wrapper };
}

export const MD_WIDTH_MARK = "\uE005";
export const MD_URL_MARKS = { " ": "\uE002", "(": "\uE003", ")": "\uE004" } as const;

const escapeAttr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export const markdownImageTag = (url: string, alt: string, width?: string | number) =>
  `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${width ? ` width="${width}"` : ""}>`;

export function markdownImageAlt(name: string): string {
  return name.replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")")).replaceAll("\\", "/").replace(/\s+/g, " ").trim();
}

function markdownImage(block: MediaBlock, editor: MediaEditor) {
  const out = imageToExternalHTML({})(block, editor);
  const img = out.dom.tagName === "IMG" ? out.dom : out.dom.querySelector("img");
  if (!img) return out;
  if (out.dom !== img) return out;
  const width = block.props.previewWidth;
  const marked = img.getAttribute("src")!.replace(/[ ()]/g, (c) => MD_URL_MARKS[c as keyof typeof MD_URL_MARKS]);
  img.setAttribute("src", marked);
  img.setAttribute("alt", `${width ? `${MD_WIDTH_MARK}${width}${MD_WIDTH_MARK}` : ""}${markdownImageAlt(img.getAttribute("alt") ?? "")}`);
  return out;
}

export const createMediaImageSpec = (options: MediaOptions = {}) =>
  createBlockSpec(createImageBlockConfig({}), {
    meta: { fileBlockAccept: ["image/*"] },
    parse: imageParse({}),
    render(block, editor) {
      const embed = parseVideoEmbed(block.props.url);
      return embed
        ? renderEmbed(block, editor, embed, options)
        : imageRender({})(block, editor);
    },
    toExternalHTML(block, editor) {
      const embed = parseVideoEmbed(block.props.url);
      if (embed && !options.markdown) return withCaption(watchLink(block.props.url, embed), block.props.caption);
      return options.markdown ? markdownImage(block, editor) : imageToExternalHTML({})(block, editor);
    },
    runsBefore: ["file"],
  })();

export const createMediaVideoSpec = (options: MediaOptions = {}) =>
  createBlockSpec(createVideoBlockConfig({}), {
    meta: { fileBlockAccept: ["video/*"] },
    parse: videoParse({}),
    render(videoBlock, videoEditor) {
      const block = videoBlock as unknown as MediaBlock;
      const editor = videoEditor as unknown as MediaEditor;
      if (!block.props.url) return VIDEO_RENDER(block, editor);
      const embed = parseVideoEmbed(block.props.url);
      return embed
        ? renderEmbed(block, editor, embed, options)
        : renderInShell(block, editor, videoPlayer(block));
    },
    toExternalHTML(block, editor) {
      if (!block.props.url) return { dom: document.createElement("video") };
      const embed = parseVideoEmbed(block.props.url);
      if (embed && options.markdown) {
        return imageToExternalHTML({})(block as unknown as MediaBlock, editor as unknown as MediaEditor);
      }
      if (embed) return withCaption(watchLink(block.props.url, embed), block.props.caption);
      if (!block.props.showPreview) {
        const link = document.createElement("a");
        link.href = block.props.url;
        link.textContent = block.props.name || block.props.url;
        return withCaption(link, block.props.caption);
      }
      const video = document.createElement("video");
      video.src = block.props.url;
      video.controls = true;
      if (block.props.previewWidth) video.width = block.props.previewWidth;
      if (!block.props.caption) return { dom: video };
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      caption.textContent = block.props.caption;
      figure.append(video, caption);
      return { dom: figure };
    },
    runsBefore: ["file"],
  })();
