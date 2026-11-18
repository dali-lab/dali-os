export function paletteMatches(item: { title: string; keywords?: string[] }, query: string): boolean {
  if (!query) return true;
  return [item.title, ...(item.keywords ?? [])].some((text) => text.toLowerCase().includes(query));
}
