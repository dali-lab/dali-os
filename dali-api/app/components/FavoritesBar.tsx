import { useCallback, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MoreHorizontal, StarOff } from 'lucide-react'
import { ContextMenu, Menu, Tooltip } from '~/components/ui/floating'
import { useToast } from '~/components/ui/toast'
import { FavoriteIcon } from '~/components/FavoriteIcon'
import { saveFavoritesOrder, setFavoriteRequest } from '~/components/favorites-live'
import { moveById } from '~/lib/favorites-order'
import { splitFavorites } from '~/components/shell/rail-model'
import { cn } from '~/lib/cn'
import type { OpenTabRequest } from '~/components/TabWorkspace'
import type { FavoritePage } from '~/lib/user-pages.server'

type TabClickProps = (req: OpenTabRequest) => Record<string, unknown>

function SortablePill({
  page,
  tabClickProps,
  onContextMenu,
}: {
  page: FavoritePage
  tabClickProps: TabClickProps
  onContextMenu?: (e: ReactMouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
      role="presentation"
      tabIndex={-1}
      className="flex-shrink-0"
    >
      <Tooltip content={page.title || 'Untitled'}>
        <button
          type="button"
          {...tabClickProps({ url: page.href, label: page.title || 'Untitled' })}
          className="flex max-w-[180px] items-center gap-1.5 rounded-full bg-os-card px-2.5 py-1 text-xs text-os-grey transition-colors hover:bg-os-card-hover hover:text-foreground"
        >
          <FavoriteIcon page={page} glyphClassName="text-os-accent" />
          <span className="truncate">{page.title || 'Untitled'}</span>
        </button>
      </Tooltip>
    </div>
  )
}

function SortableRailRow({
  page,
  active,
  tabClickProps,
}: {
  page: FavoritePage
  active: boolean
  tabClickProps: TabClickProps
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} role="presentation" tabIndex={-1}>
      <button
        type="button"
        {...tabClickProps({ url: page.href, label: page.title || 'Untitled' })}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 w-full items-center gap-2.5 rounded-lg pl-2.5 pr-2 text-left text-sm text-foreground transition-colors',
          active ? 'bg-os-hover-strong font-semibold' : 'hover:bg-os-hover',
        )}
      >
        <FavoriteIcon page={page} size="rail" glyphClassName="text-os-grey" />
        <span className="truncate">{page.title || 'Untitled'}</span>
      </button>
    </div>
  )
}

export function FavoritesBar({
  favorites,
  onChange,
  tabClickProps,
  orientation = 'horizontal',
  activeHref,
}: {
  favorites: FavoritePage[]
  onChange: (next: FavoritePage[]) => void
  tabClickProps: TabClickProps
  orientation?: 'horizontal' | 'vertical'
  activeHref?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const toast = useToast()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const commitOrder = useCallback(
    async (next: FavoritePage[]) => {
      const prev = favorites
      onChange(next)
      if (!(await saveFavoritesOrder(next.map((p) => p.id)))) {
        onChange(prev)
        toast.error("Couldn't save the new order")
      }
    },
    [favorites, onChange, toast],
  )

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = favorites.findIndex((p) => p.id === e.active.id)
    const to = favorites.findIndex((p) => p.id === e.over!.id)
    if (from === -1 || to === -1) return
    void commitOrder(arrayMove(favorites, from, to))
  }

  const remove = async (page: FavoritePage) => {
    const prev = favorites
    onChange(favorites.filter((p) => p.id !== page.id))
    const ok = await setFavoriteRequest(
      page.isRoute ? { href: page.href, label: page.title } : { pageId: page.id },
      false,
    )
    if (!ok) {
      onChange(prev)
      toast.error("Couldn't remove from favorites")
    }
  }

  if (orientation === 'vertical') {
    const { visible, canToggle } = splitFavorites(favorites, expanded)
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex h-[26px] items-center pl-2.5 text-xs font-semibold text-os-muted">Favorites</div>
        <DndContext id="favorites-rail" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {visible.map((p) => {
              const i = favorites.findIndex((f) => f.id === p.id)
              return (
                <ContextMenu
                  key={p.id}
                  ariaLabel="Favorite actions"
                  items={
                    <>
                      <Menu.Item
                        icon={<ArrowUp className="h-3.5 w-3.5" />}
                        disabled={i === 0}
                        onSelect={() => void commitOrder(moveById(favorites, p.id, -1))}
                      >
                        Move up
                      </Menu.Item>
                      <Menu.Item
                        icon={<ArrowDown className="h-3.5 w-3.5" />}
                        disabled={i === favorites.length - 1}
                        onSelect={() => void commitOrder(moveById(favorites, p.id, 1))}
                      >
                        Move down
                      </Menu.Item>
                      <Menu.Item icon={<StarOff className="h-3.5 w-3.5" />} onSelect={() => void remove(p)}>
                        Remove from favorites
                      </Menu.Item>
                    </>
                  }
                >
                  <SortableRailRow page={p} active={p.href === activeHref} tabClickProps={tabClickProps} />
                </ContextMenu>
              )
            })}
          </SortableContext>
        </DndContext>
        {canToggle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex h-8 w-full items-center gap-2.5 rounded-lg pl-2.5 pr-2 text-left text-sm text-os-muted transition-colors hover:bg-os-hover"
          >
            <MoreHorizontal className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {expanded ? 'Show less' : 'View all'}
          </button>
        )}
      </div>
    )
  }

  return (
    <DndContext id="favorites-bar" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={favorites.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex items-center gap-2">
          {favorites.map((p, i) => (
            <ContextMenu
              key={p.id}
              ariaLabel="Favorite actions"
              items={
                <>
                  <Menu.Item
                    icon={<ArrowLeft className="h-3.5 w-3.5" />}
                    disabled={i === 0}
                    onSelect={() => void commitOrder(moveById(favorites, p.id, -1))}
                  >
                    Move left
                  </Menu.Item>
                  <Menu.Item
                    icon={<ArrowRight className="h-3.5 w-3.5" />}
                    disabled={i === favorites.length - 1}
                    onSelect={() => void commitOrder(moveById(favorites, p.id, 1))}
                  >
                    Move right
                  </Menu.Item>
                  <Menu.Item
                    icon={<StarOff className="h-3.5 w-3.5" />}
                    onSelect={() => void remove(p)}
                  >
                    Remove from favorites
                  </Menu.Item>
                </>
              }
            >
              <SortablePill page={p} tabClickProps={tabClickProps} />
            </ContextMenu>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
