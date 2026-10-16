import { useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
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
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft, ArrowRight, StarOff } from 'lucide-react'
import { ContextMenu, Menu, Tooltip } from '~/components/ui/floating'
import { useToast } from '~/components/ui/toast'
import { FavoriteIcon } from '~/components/FavoriteIcon'
import { saveFavoritesOrder, setFavoriteRequest } from '~/components/favorites-live'
import { moveById } from '~/lib/favorites-order'
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

export function FavoritesBar({
  favorites,
  onChange,
  tabClickProps,
}: {
  favorites: FavoritePage[]
  onChange: (next: FavoritePage[]) => void
  tabClickProps: TabClickProps
}) {
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
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
