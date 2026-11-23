import * as Y from "yjs";
import { deckMap, restoreEpochOf, slidesMap } from "~/components/slides/deck/model";

function copyInto(from: Y.Map<unknown>, to: Y.Map<unknown>): void {
  from.forEach((value, key) => to.set(key, cloneValue(value)));
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const m = new Y.Map();
    value.forEach((v, k) => m.set(k, cloneValue(v)));
    return m;
  }
  if (value instanceof Y.XmlFragment) {
    const f = new Y.XmlFragment();
    f.insert(0, value.toArray().map((n) => n.clone()) as Array<Y.XmlText | Y.XmlElement>);
    return f;
  }
  return value;
}

/**
 * Clears the live deck and reapplies a snapshot in one transaction on the live doc, so it keeps its own clientID.
 * Old fragments are dropped, so editors must remount when `deck.restoreEpoch` changes.
 */
export function restoreDeck(live: Y.Doc, snapshotState: Uint8Array, origin: unknown = "restore"): void {
  const snap = new Y.Doc();
  try {
    Y.applyUpdate(snap, snapshotState);
    live.transact(() => {
      const epoch = restoreEpochOf(live) + 1;
      const liveSlides = slidesMap(live);
      for (const key of Array.from(liveSlides.keys())) liveSlides.delete(key);
      const liveDeck = deckMap(live);
      for (const key of Array.from(liveDeck.keys())) liveDeck.delete(key);
      copyInto(deckMap(snap), liveDeck);
      copyInto(slidesMap(snap) as Y.Map<unknown>, liveSlides as Y.Map<unknown>);
      liveDeck.set("restoreEpoch", epoch);
    }, origin);
  } finally {
    snap.destroy();
  }
}
