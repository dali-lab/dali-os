#!/usr/bin/env python3
"""
Prepare the week 5 milestone art for use as a landing background.

The Figma export (Week5_Milestone.svg) is a whole mockup of the page: the block board on the
left, and on the right a panel with the milestone number, title and body copy drawn as vector
outlines. The landing renders that chrome itself, as live text, so the panel is dropped here and
only the board is kept. Everything else -- the geometry, the embedded <style> block and its
sixteen keyframe animations -- is passed through untouched.

Run it by hand when the export is replaced:  python3 scripts/prep-week5-art.py
"""
import pathlib
import re
import sys

SOURCE = pathlib.Path('src/assets/Week5_Milestone.svg')
OUT = pathlib.Path('src/assets/week5/blocks.svg')

# The panel holding "06 Build", the date line and the body copy. It is the only child of the root
# layer that is not a block, which is also how it was found: every other child is a 221px-grid
# piece, and this one is 1465x589 of lettering.
TEXT_PANEL = 'Group_14312'


def cut_element(svg: str, element_id: str) -> str:
    """Remove one element and everything inside it, matching tags rather than guessing at length."""
    opening = re.search(rf'<(\w+)\b[^>]*\bid="{re.escape(element_id)}"[^>]*?(/?)>', svg)
    if not opening:
        raise SystemExit(f'{element_id} is not in the export -- has it been re-exported?')
    tag, self_closing = opening.group(1), opening.group(2)
    if self_closing:
        return svg[:opening.start()] + svg[opening.end():]
    depth, cursor = 1, opening.end()
    for token in re.finditer(rf'<(/?){tag}\b[^>]*?(/?)>', svg[opening.end():]):
        closing, empty = token.group(1), token.group(2)
        if empty:
            continue
        depth += -1 if closing else 1
        if depth == 0:
            cursor = opening.end() + token.end()
            break
    else:
        raise SystemExit(f'{element_id} is never closed')
    return svg[:opening.start()] + svg[cursor:]


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'{SOURCE} not found')
    svg = SOURCE.read_text()
    before = len(svg)
    svg = cut_element(svg, TEXT_PANEL)

    # Let the stylesheet size it. The viewBox stays, so the board keeps its proportions and the
    # animation's pixel transforms keep meaning what they meant in Figma.
    svg = re.sub(r'^<svg\s+width="\d+"\s+height="\d+"\s+', '<svg ', svg, count=1)
    if not svg.startswith('<svg viewBox'):
        raise SystemExit('the root <svg> is not shaped the way this script expects')

    # How the board fills a window that is not its shape. This has to be an attribute on the SVG:
    # object-fit is for replaced elements -- an <img>, a <video> -- and an inline <svg> ignores it
    # entirely, which silently letterboxes the board into a band with black above and below.
    #
    # "slice" fills the box and lets the overflow run off the edge, the way object-fit: cover
    # would. "xMin" keeps that overflow off the right: the eleven columns end at x=2431 of 4075
    # and the rest of the frame is empty black, so cropping the right loses nothing while
    # centring would cut the leftmost column. "YMid" centres what is left vertically.
    svg = svg.replace('<svg viewBox', '<svg preserveAspectRatio="xMinYMid slice" viewBox', 1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg)

    keyframes = len(re.findall(r'@keyframes', svg))
    animated = len(re.findall(r'animation:', svg))
    print(f'  {SOURCE}  {before / 1024:.0f} KB')
    print(f'  dropped {TEXT_PANEL} (the milestone number, title and body copy)')
    print(f'  {OUT}  {len(svg) / 1024:.0f} KB, {keyframes} keyframes across {animated} groups')


if __name__ == '__main__':
    sys.exit(main())
