import { Fragment } from "react";
import { MenuItem, MenuSeparator, MenuSub } from "~/components/ui/floating/Menu";
import type { ActionSpec } from "./actions";

/** Draws a list of actions as menu rows, with submenus for the ones that have children. Context menus and the format bar's menus both use it. */
export function ActionMenuItems({ actions }: { actions: ActionSpec[] }) {
  return (
    <>
      {actions.map((a) => {
        const icon = a.icon ? <a.icon className="h-4 w-4" aria-hidden /> : undefined;
        return (
          <Fragment key={a.id}>
            {a.dividerBefore && <MenuSeparator />}
            {a.children ? (
              <MenuSub label={a.label} icon={icon} disabled={a.disabled}>
                <ActionMenuItems actions={a.children} />
              </MenuSub>
            ) : (
              <MenuItem icon={icon} shortcut={a.shortcut} checked={a.checked} disabled={a.disabled} destructive={a.destructive} onSelect={a.run}>
                {a.label}
              </MenuItem>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
