import { ProfilePhotoAvatar } from "~/components/ProfilePhotoAvatar";
import { AccountSettingsSection } from "~/members/components/MemberProfileView";
import type { ProfilePageData } from "~/members/lib/profile-page.server";

export function AccountSettingsBlock({ profile }: { profile: ProfilePageData }) {
  const { member, roleLabels, canEdit, photoUrlResolved } = profile;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <ProfilePhotoAvatar
          userId={member.id}
          name={`${member.firstName} ${member.lastName}`}
          initialPreviewUrl={photoUrlResolved}
          canEdit={canEdit}
        />
        <div className="min-w-0">
          <p className="font-heading text-lg font-semibold text-foreground">
            {member.firstName} {member.lastName}
          </p>
          {member.pronouns && (
            <p className="text-sm text-muted-foreground">{member.pronouns}</p>
          )}
        </div>
      </div>
      <AccountSettingsSection
        member={member}
        roleLabels={roleLabels}
        canEdit={canEdit}
        formAction="/settings"
        embedded
      />
    </div>
  );
}
