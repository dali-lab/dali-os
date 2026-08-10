// Browser-style back/forward stack helpers. TabWorkspace keeps per-tab
// stacks in localStorage; tabless mode uses a single global stack in memory.

export const HISTORY_CAP = 50;

export interface NavigationHistoryStacks {
  backStack: string[];
  forwardStack: string[];
}

export function recordNavigation(
  stacks: NavigationHistoryStacks,
  fromUrl: string,
  toUrl: string,
): NavigationHistoryStacks {
  if (fromUrl === toUrl) return stacks;
  const back = [...stacks.backStack, fromUrl];
  if (back.length > HISTORY_CAP) back.splice(0, back.length - HISTORY_CAP);
  return { backStack: back, forwardStack: [] };
}

export function navigateHistoryStacks(
  stacks: NavigationHistoryStacks,
  currentUrl: string,
  direction: "back" | "forward",
  steps = 1,
): { stacks: NavigationHistoryStacks; target: string } | null {
  const source = direction === "back" ? stacks.backStack : stacks.forwardStack;
  if (steps < 1 || steps > source.length) return null;
  const consumed = source.slice(source.length - steps);
  const target = consumed[0];
  const opposite: string[] = [currentUrl];
  for (let k = consumed.length - 1; k >= 1; k--) opposite.push(consumed[k]);

  if (direction === "back") {
    const forwardStack = [...stacks.forwardStack, ...opposite];
    if (forwardStack.length > HISTORY_CAP) {
      forwardStack.splice(0, forwardStack.length - HISTORY_CAP);
    }
    return {
      stacks: {
        backStack: stacks.backStack.slice(0, stacks.backStack.length - steps),
        forwardStack,
      },
      target,
    };
  }

  const backStack = [...stacks.backStack, ...opposite];
  if (backStack.length > HISTORY_CAP) backStack.splice(0, backStack.length - HISTORY_CAP);
  return {
    stacks: {
      backStack,
      forwardStack: stacks.forwardStack.slice(0, stacks.forwardStack.length - steps),
    },
    target,
  };
}
