import { requireAuth, unauthorized, forbidden, isPartnerAccount, isNonMember } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isAdmin, isCore } from "~/lib/roles";
import { NotificationsSettingsBlock } from "~/components/settings/NotificationsSettingsBlock";
import { digestHourOptions, digestHourToStore } from "~/components/settings/digest-hours";
import { loadDigestSchedule } from "~/lib/settings-page.server";
import { saveNotificationSettings } from "~/lib/notification-settings.server";
import { useSettingsData } from "./settings";
import type { Route } from "./+types/settings.notifications";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (await isNonMember(auth, request)) return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);

  const form = await request.formData();

  if (form.get("intent") === "digest-hour") {
    const { dailyHour } = await loadDigestSchedule();
    const hour = Number(form.get("hour"));
    if (!digestHourOptions(dailyHour).includes(hour)) {
      return { ok: false as const, error: "Pick one of the listed times." };
    }
    await prisma.user.update({
      where: { id: auth.user.sub },
      data: { digestHourEt: digestHourToStore(hour, dailyHour) },
    });
    return { ok: true as const, error: null };
  }

  return saveNotificationSettings(auth.user.sub, form, {
    audience: "member",
    isAdmin: await isAdmin(auth.user.sub),
    isCore: await isCore(auth.user.sub),
  });
}

export default function SettingsNotifications() {
  const data = useSettingsData();
  return <NotificationsSettingsBlock {...data.notifications} />;
}
