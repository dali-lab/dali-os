#!/usr/bin/env python3
"""
Prepare the week 8 milestone art for use as a landing background.

The Figma export (Week_8_Milestone.svg) is a whole mockup of the page: a wall of foliage with
three insects in it, and over the right-hand half a translucent card carrying the milestone
number, title, date line and body copy drawn as vector outlines. The landing renders that
chrome itself, as live text, so the card and the lettering are dropped here and only the scene
is kept.

Everything else -- the 2168 paths, the embedded <style> block and its 51 keyframe animations --
is passed through untouched.

Run it by hand from dali-api/ when the export is replaced (the export itself is not committed):

    python3 scripts/prep-week8-art.py path/to/Week_8_Milestone.svg
"""
import pathlib
import re
import sys

SOURCE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'Week_8_Milestone.svg')
OUT = pathlib.Path('app/assets/landing/week8/foliage.svg')
BUTTERFLY_OUT = pathlib.Path('app/assets/landing/week8/butterfly.fragment.svg')

# The copy panel, in two pieces: the card it sits on, and the lettering on top of it.
#
# Rectangle_547 is a 1770x1539 rounded rect at x=2312 filled #393939 at 0.27 -- a grey wash over
# the right 43% of the frame. Keeping it would put a visible vertical seam down the middle of the
# page, which is exactly what it looks like in the raw export.
#
# Group_14312 is the lettering: "08", "Bug Hunt", "Week 1 - Sep 15 – 19" and the body copy, all
# outlined. The landing draws its own, and the drawn ones still carry the template's placeholder
# week and dates.
COPY_PANEL = ('Rectangle_547', 'Group_14312')

# Figma's clip rect is 4076.87 wide inside a 4077-wide viewBox, which leaves the last column of
# the frame at 98% alpha for two thirds of its height -- a hairline of page background down the
# right edge, visible only on a window wider than the scene's 2.64:1. Dropping one unit off the
# viewBox is exact and costs nothing. Measured at full size, the rest of the frame is opaque:
# 42 pixels below alpha 250 in 6.3 million, all of them seams between abutting leaves, which the
# scene-coloured background behind the SVG covers.
VIEWBOX = ('0 0 4077 1545', '0 0 4076 1545')

# Decimal places kept in path data.
#
# Figma writes coordinates to three to eight places, and path data is 80% of this export -- 1.09
# MB of the 1.32 MB that reaches the browser, because organic leaf outlines share almost no
# geometry and so barely compress (the file gzips 2.5:1, where week 7's studio managed 17.4:1).
#
# Two places is far below anything a screen can resolve. The frame is 4076 units wide and the
# widest slice any window shows is about 2750 of them, so on a 2560px display at dpr 2 one unit is
# 1.86 device pixels and 0.01 of one is 0.019 of a pixel. Measured rather than assumed: rendering
# the scene at full size with the stylesheet stripped, before and after, 698 pixels out of
# 6,297,420 differ by more than 8/255, every one of them on a path edge. The saving is 260 KB
# raw, 148 KB gzipped.
#
# Only `d` attributes are touched. The keyframes carry rotations in radians, where a hundredth is
# a much coarser thing, and they are only 7% of the file.
PLACES = 2

# Which of the export's swaying leaves each stationary creature is actually sitting on, found by
# recolouring one leaf group at a time and looking: every one of these five groups turns out to be
# a single leaf. The ladybird is in the middle of Group_2's leaf and the centipede on Group_1's.
#
# The butterfly is deliberately absent. It sits on a leaf the export does not animate, so "moving
# with its leaf" means staying exactly where it is.
RIDERS = {'Group_14311': 'Group_2', 'Group_19': 'Group_1'}

# Every leaf gets a ride generated, not just the two with riders, because the overlay in
# Undergrowth.tsx hangs ants, a spider and dew off them too.
LEAVES = ('Group_6', 'Group_2', 'Group_4', 'Group_5', 'Group_1')
NUMBER = re.compile(r'-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def span_of(svg: str, element_id: str) -> tuple[int, int]:
    """Where one element starts and ends, matching tags rather than guessing at length."""
    opening = re.search(rf'<(\w+)\b[^>]*\bid="{re.escape(element_id)}"[^>]*?(/?)>', svg)
    if not opening:
        raise SystemExit(f'{element_id} is not in the export -- has it been re-exported?')
    tag, self_closing = opening.group(1), opening.group(2)
    if self_closing:
        return opening.start(), opening.end()
    depth = 1
    for token in re.finditer(rf'<(/?){tag}\b[^>]*?(/?)>', svg[opening.end():]):
        closing, empty = token.group(1), token.group(2)
        if empty:
            continue
        depth += -1 if closing else 1
        if depth == 0:
            return opening.start(), opening.end() + token.end()
    raise SystemExit(f'{element_id} is never closed')


def cut_element(svg: str, element_id: str) -> str:
    """Remove one element and everything inside it."""
    start, end = span_of(svg, element_id)
    return svg[:start] + svg[end:]


def shrink_paths(svg: str) -> str:
    """Round every number in every `d` attribute to PLACES decimals."""
    def round_number(match: re.Match[str]) -> str:
        value = round(float(match.group(0)), PLACES)
        if value == 0:
            return '0'
        # Figma emits exponent notation for near-zero values (6.83371e-05); formatting through a
        # fixed number of places is what collapses those to a plain 0 rather than mangling them
        # into 6.8e-05, which a digits-only regex would do.
        return f'{value:.{PLACES}f}'.rstrip('0').rstrip('.') or '0'

    return re.sub(r' d="([^"]+)"',
                  lambda m: ' d="' + NUMBER.sub(round_number, m.group(1)) + '"',
                  svg)


def retime(svg: str) -> tuple[str, list[tuple[str, float, int]]]:
    """Strip the dead air out of the export's own keyframes.

    Figma gives every object one short gesture and then pads the rest of the timeline with a
    repeat of its final pose. Measured across all 51 tracks: every one of them is frozen from its
    penultimate stop to 100%, and 32 of the 51 have stopped moving by 42%. The median last stop is
    37.74%, so on a 5.3s loop the whole scene moves for two seconds and then holds a still frame
    for three and a third -- and because they nearly all share that boundary, they freeze and
    restart *together*. That synchronised hitch is what reads as choppiness; it is not dropped
    frames.

    This finds where each track actually stops moving and rescales its timeline so the gesture
    fills the cycle. Nothing is invented: the poses and the per-segment easings are the export's,
    only the clock is redrawn. week8.css then gives each creature its own duration and phase, so
    the tracks no longer line up even after this.
    """
    style = re.search(r'<style>(.*?)</style>', svg, re.S)
    if not style:
        raise SystemExit('the export has no <style> block -- has it been re-exported?')
    source, out, report, read = style.group(1), [], [], 0

    # One pass over the original text, appending either the rewritten block or the text between
    # blocks. Rewriting in place with str.replace would invalidate every later match offset.
    for block in re.finditer(r'@keyframes\s+(\S+)\s*\{', source):
        name = block.group(1)
        opening = block.end() - 1
        depth, cursor = 0, opening
        while True:
            depth += {'{': 1, '}': -1}.get(source[cursor], 0)
            if depth == 0:
                break
            cursor += 1
        original = source[opening:cursor + 1]
        out.append(source[read:opening])
        read = cursor + 1

        stops = re.findall(r'(\d+(?:\.\d+)?)%\s*\{(.*?)\n\s*\}', original, re.S)
        prop = 'opacity' if stops and re.search(r'\bopacity:', stops[0][1]) else 'transform'

        def pose(stop: tuple[str, str]) -> str:
            found = re.search(rf'{prop}:\s*([^;]+);', stop[1])
            return found.group(1).strip() if found else ''

        # Walk back from the end over every stop that merely repeats the final pose. The first one
        # that reaches it is the moment the gesture finishes; everything after is padding.
        last = len(stops) - 1
        while last > 1 and pose(stops[last - 1]) == pose(stops[last]):
            last -= 1
        end = float(stops[last][0]) if stops else 0.0
        if len(stops) < 3 or last == len(stops) - 1 or end <= 0:
            out.append(original)
            continue

        rebuilt = []
        for percent, declarations in stops[:last + 1]:
            # An animation-timing-function inside a stop governs the segment that *starts* there,
            # so it travels with its stop and is carried through untouched.
            rebuilt.append(f'  {float(percent) * 100 / end:.4g}% {{{declarations}\n  }}')
        out.append('{\n' + '\n'.join(rebuilt) + '\n}')
        report.append((name, end, len(stops) - 1 - last))

    out.append(source[read:])
    body = ''.join(out)
    return svg[:style.start(1)] + body + svg[style.end(1):], report


def leaf_rides(svg: str) -> str:
    """Let things sitting on a leaf sway with it.

    The export animates five leaves and then draws the ladybird and the centipede as siblings of
    them, so the leaf moves and the insect on it does not. Up close that is the thing that gives
    the whole scene away.

    The fix is to work out, for each leaf, the motion it undergoes *in frame coordinates*, and give
    that same motion to whatever is riding it. Figma writes each leaf's transform as

        S  .  A  .  P . R . P-1  .  K

    where S is the leaf's static placement, A the animated offset, P the pivot translate, R the
    animated rotation and K a static flip or skew. At rest A and R are identity, so the leaf's
    resting transform is S . K, and the motion it actually performs is

        M = T . T0-1 = S . A . P . R . P-1 . K . K-1 . S-1 = A . S . P . R . P-1 . S-1

    K falls out, and because S and A are both translations they commute, so

        M = A . translate(S + P) . R . translate(-(S + P))

    which is to say: keep the animated translate and rotation, throw away the static placement and
    the flip, and shift the pivot into frame coordinates. Those pivots are worth a sanity check --
    derived this way they come out at (250, 828), (1045, 200), (1275, 1443), (1777, 141) and
    (1950, 1217), against measured centroids for the five leaf masks of (264, 775), (1080, 243),
    (1203, 1316), (1772, 226) and (1966, 1211). Each pivot lands in the middle of its own leaf.

    The riders are wrapped in a plain group that carries the ride, rather than having it applied to
    them directly, because #Group_14311 and #Group_19 have transform attributes of their own and a
    CSS `transform` animation would replace them. Going through the individual `rotate`/`translate`
    properties instead does not help: those compose outside the attribute but transform-origin wraps
    the whole chain, which puts the attribute's own rotation inside the pivot sandwich and moves the
    bug at rest. A wrapper with no transform of its own has neither problem.
    """
    style = re.search(r'<style>(.*?)</style>', svg, re.S)
    if not style:
        raise SystemExit('the export has no <style> block -- has it been re-exported?')

    shape = re.compile(
        r'translateX\((-?[\d.e+-]+)px\) translateY\((-?[\d.e+-]+)px\) '
        r'translateX\((-?[\d.e+-]+)px\) translateY\((-?[\d.e+-]+)px\) '
        r'translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) rotate\((-?[\d.e+-]+)rad\)')

    rides = []
    for leaf in LEAVES:
        block = re.search(rf'@keyframes kf_{leaf}_transform_0\s*\{{', style.group(1))
        if not block:
            raise SystemExit(f'{leaf} has no transform keyframes -- has it been re-exported?')
        opening = block.end() - 1
        depth, cursor = 0, opening
        while True:
            depth += {'{': 1, '}': -1}.get(style.group(1)[cursor], 0)
            if depth == 0:
                break
            cursor += 1
        stops = re.findall(r'(\d+(?:\.\d+)?)%\s*\{(.*?)\n\s*\}', style.group(1)[opening:cursor + 1], re.S)

        rebuilt = []
        for percent, declarations in stops:
            found = re.search(r'transform:\s*([^;]+);', declarations)
            parts = shape.match(found.group(1)) if found else None
            if not parts:
                raise SystemExit(f'{leaf} keyframe at {percent}% is not shaped the way this script expects')
            sx, sy, ax, ay, px, py, radians = (float(v) for v in parts.groups())
            ox, oy = px + sx, py + sy
            easing = re.search(r'animation-timing-function:\s*([^;]+);', declarations)
            lines = [f'    animation-timing-function: {easing.group(1)};'] if easing else []
            lines.append(
                f'    transform: translateX({ax:g}px) translateY({ay:g}px) '
                f'translate({ox:g}px, {oy:g}px) rotate({radians:g}rad) '
                f'translate({-ox:g}px, {-oy:g}px);')
            rebuilt.append(f'  {percent}% {{\n' + '\n'.join(lines) + '\n  }')
        rides.append(f'@keyframes w8-ride-{leaf} {{\n' + '\n'.join(rebuilt) + '\n}')

    svg = svg[:style.end(1)] + '\n' + '\n\n'.join(rides) + '\n' + svg[style.end(1):]

    for rider, leaf in RIDERS.items():
        start, end = span_of(svg, rider)
        svg = (svg[:start]
               + f'<g class="w8-ride w8-ride-{leaf}">' + svg[start:end] + '</g>'
               + svg[end:])
    return svg


def split_butterfly_shadow(svg: str) -> str:
    """Stop the butterfly's drop shadow from being recomputed sixty times a second.

    The export puts a drop shadow (stdDeviation 25.77, over a 1005x1018 region) on #Group and
    animates its two wing groups *inside* it, so the browser re-runs that blur every frame.
    Measured as renderer CPU at 2560x1440 and dpr 2, three interleaved twenty-second runs of each
    build: 1.69s of process time with the shadow static against 1.90s with it live, 0.54s against
    0.62s on the main thread, 0.50s against 0.58s in tasks. So about 11-14%, consistently, with the
    ranges barely overlapping.

    Not the 24% a first pass suggested -- that figure came from deleting the shadow outright, which
    skips the blur *and* the extra layer, and is not what this does. A static pass still pays for
    the filter once and for a second copy of the butterfly's eight paths.

    Week 7 solved its version of this by hoisting the moving group clear of the filter, which does
    not work here: the shadow is the butterfly's own. So the shadow is split off instead. A copy of
    the group is drawn underneath through a shadow-only filter -- the export's own chain with the
    final `feBlend in="SourceGraphic"` removed, so it outputs the shadow and not the butterfly --
    with every id stripped, which is what makes it static: the export's keyframes are selected by
    id, so a copy without them sits at the pose the scene was drawn in. The live butterfly then
    paints over it with no filter at all.

    Both get a handle for the fly-away (Week8Background.tsx). The live butterfly is wrapped in a
    <g class="w8-butterfly"> with no transform of its own, because #Group carries a transform
    attribute and a CSS transform animation would replace it rather than compose with it. The
    shadow copy is tagged w8-butterfly-shadow and left outside the wrapper: when the butterfly
    lifts off, its shadow stays on the leaf and fades.

    The cost is that the shadow no longer tracks the wing fold, and that was measured rather than
    waved through. Rendered at four phases of the loop against the live-shadow build, the frames
    where the wings are open are identical to within antialiasing (46 pixels in 688,800 differ by
    more than 24/255); the frames where they fold to scaleX(0.6) leave a faint wider halo outside
    the wing edge, 3% of the crop differing by more than 8/255 with a maximum of 52/255. At this
    blur radius that reads as the soft patch it already was, and on desktop it sits behind the
    frosted glass anyway.
    """
    original = re.search(r'<filter id="filter0_d_2782_5341".*?</filter>', svg, re.S)
    if not original:
        raise SystemExit('the butterfly drop shadow is not in the export -- has it been re-exported?')
    shadow_only = original.group(0).replace('id="filter0_d_2782_5341"', 'id="w8-butterfly-shadow"')
    shadow_only = re.sub(r'<feBlend[^>]*\bin="SourceGraphic"[^>]*/>', '', shadow_only)
    if 'SourceGraphic' in shadow_only:
        raise SystemExit('the drop shadow chain is not shaped the way this script expects')

    start, end = span_of(svg, 'Group')
    butterfly = svg[start:end]
    if 'url(#filter0_d_2782_5341)' not in butterfly:
        raise SystemExit('#Group no longer carries the drop shadow this script splits')

    frozen = re.sub(r'\s*\bid="[^"]*"', '', butterfly)
    frozen = frozen.replace(
        'filter="url(#filter0_d_2782_5341)"',
        'class="w8-butterfly-shadow" filter="url(#w8-butterfly-shadow)"',
        1,
    )
    live = butterfly.replace(' filter="url(#filter0_d_2782_5341)"', '', 1)
    live = f'<g class="w8-butterfly">{live}</g>'

    svg = svg[:start] + frozen + live + svg[end:]
    defs = svg.index('<defs>') + len('<defs>')
    return svg[:defs] + shadow_only + svg[defs:]


def lift_butterfly(svg: str) -> tuple[str, str]:
    """Take the live butterfly out of the export so it can be drawn above the added layer.

    The ant column walks the leaf the butterfly sits on, and Undergrowth.tsx draws everything it
    adds in a second <svg> on top of the export -- so with the butterfly left in here, the ants
    walk over its wings. Two inline SVGs cannot interleave, so the butterfly moves to the overlay
    instead: this cuts the <g class="w8-butterfly"> wrapper out and returns it as a fragment, which
    Undergrowth.tsx injects after the ants and the spider and before the pollen.

    That is safe because nothing about where it is drawn depends on what it was inside. Its only
    ancestor is the frame's clip group, which carries no transform, and the overlay has the same
    viewBox, so its own transform attribute lands it in the same place. It references no <defs>.
    And the export's keyframes are selected by id from a <style> block that is global to the page
    once inlined, so #Group's wings keep animating wherever #Group is.

    The static shadow stays behind in the export, on the leaf and under the ants, which is where a
    shadow belongs.
    """
    start = svg.find('<g class="w8-butterfly">')
    if start < 0:
        raise SystemExit('the butterfly wrapper is missing -- has split_butterfly_shadow changed?')
    depth = 0
    for token in re.finditer(r'<(/?)g\b[^>]*?(/?)>', svg[start:]):
        if token.group(2):
            continue
        depth += -1 if token.group(1) else 1
        if depth == 0:
            end = start + token.end()
            break
    else:
        raise SystemExit('the butterfly wrapper is never closed')
    fragment = svg[start:end]
    if 'url(#' in fragment:
        raise SystemExit('the butterfly now references <defs>, which stay behind in the export')
    return svg[:start] + svg[end:], fragment


def prune_defs(svg: str) -> tuple[str, list[str]]:
    """Drop the <defs> entries nothing refers to any more.

    Four of the export's five drop-shadow filters belonged to the four lines of lettering, so
    cutting the panel strands them. Nothing renders an unreferenced filter, so this is hygiene
    rather than a saving -- but it also means a re-export that moves the copy around cannot
    quietly leave a filter behind that no longer matches anything.
    """
    defs = re.search(r'<defs>(.*)</defs>', svg, re.S)
    if not defs:
        raise SystemExit('the export has no <defs> -- has it been re-exported?')
    dropped = []
    for block in re.finditer(r'<(filter|clipPath|linearGradient|radialGradient|mask|pattern)\b[^>]*\bid="([^"]+)"[^>]*>.*?</\1>',
                             defs.group(1), re.S):
        element_id = block.group(2)
        if f'url(#{element_id})' not in svg:
            dropped.append(element_id)
    for element_id in dropped:
        svg = cut_element(svg, element_id)
    return svg, dropped


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'{SOURCE} not found')
    svg = SOURCE.read_text()
    before = len(svg)

    for element_id in COPY_PANEL:
        svg = cut_element(svg, element_id)
    svg, retimed = retime(svg)
    svg = split_butterfly_shadow(svg)
    svg = leaf_rides(svg)
    # After the split, not before: the split strands the export's own drop-shadow filter, and
    # pruning first would have left it behind.
    svg, dropped = prune_defs(svg)
    cut = len(svg)
    svg = shrink_paths(svg)
    svg, butterfly = lift_butterfly(svg)

    # Let the stylesheet size it. The viewBox stays, so the scene keeps its proportions and the
    # animation's pixel transforms keep meaning what they meant in Figma.
    svg = re.sub(r'^<svg\s+width="\d+"\s+height="\d+"\s+', '<svg ', svg, count=1)
    if not svg.startswith(f'<svg viewBox="{VIEWBOX[0]}"'):
        raise SystemExit('the root <svg> is not shaped the way this script expects')
    svg = svg.replace(f'viewBox="{VIEWBOX[0]}"', f'viewBox="{VIEWBOX[1]}"', 1)

    # How the scene fills a window that is not its shape. This has to be an attribute on the SVG:
    # object-fit is for replaced elements -- an <img>, a <video> -- and an inline <svg> ignores it
    # entirely, which silently letterboxes the scene into a band with the page showing above and
    # below it.
    #
    # "slice" fills the box and lets the overflow run off the edge, the way object-fit: cover
    # would. "xMin" keeps that overflow off the right, where the foliage is still and the copy
    # column sits: sweeping the loop in 0.1s steps puts everything that moves -- the butterfly,
    # the ladybird, the centipede and the leaves that sway -- inside x=-157..2370 of 4076.
    # "YMid" centres what is left vertically. week8.css slides the slice right of xMin as the
    # window narrows, because a portrait slice anchored here cuts the butterfly in half.
    svg = svg.replace('<svg viewBox', '<svg preserveAspectRatio="xMinYMid slice" viewBox', 1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg)
    BUTTERFLY_OUT.write_text(butterfly + '\n')

    keyframes = len(re.findall(r'@keyframes', svg))
    animated = len(re.findall(r'animation:', svg))
    print(f'  {SOURCE}  {before / 1024:.0f} KB')
    print(f'  dropped {", ".join(COPY_PANEL)} (the copy card and the lettering on it)')
    print(f'  pruned {len(dropped)} unreferenced defs: {", ".join(dropped) or "none"}')
    if retimed:
        held = sum(100 - end for _, end, _ in retimed) / len(retimed)
        print(f'  retimed {len(retimed)} of 51 tracks: {held:.0f}% of each loop was a held frame')
    print("  split the butterfly's drop shadow off into a static pass")
    print(f'  derived {len(LEAVES)} leaf rides; {len(RIDERS)} of the export\'s insects now sway with their leaf')
    print(f'  rounded path data to {PLACES} places: {(cut - len(svg)) / 1024:.0f} KB off')
    print(f'  {OUT}  {len(svg) / 1024:.0f} KB, {keyframes} keyframes across {animated} elements')
    print(f'  {BUTTERFLY_OUT}  {len(butterfly) / 1024:.1f} KB, lifted above the ants')


if __name__ == '__main__':
    sys.exit(main())
