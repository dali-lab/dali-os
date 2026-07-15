# Desktop release — S3 / IAM setup

Desktop updates are published by `.github/workflows/desktop-release.yml` to a
**dedicated public bucket**, `dali-os-desktop-releases` (us-east-1), and
downloaded **anonymously** by the installed app's updater. Layout:

- `s3://dali-os-desktop-releases/latest.json` — the updater feed
- `s3://dali-os-desktop-releases/releases/<version>/` — the signed `.app.tar.gz` + `.dmg`

This bucket holds only public release artifacts — no private data ever lives
here — so the whole bucket is public-read. The private uploads bucket
(`dali-os-uploads-prod`) stays fully locked with Block Public Access ON; app
uploads use presigned URLs and never need a public policy.

> Channels (future): a `staging/` prefix (e.g. `staging/latest.json`) can host a
> separate feed later without touching the stable feed at the root.

## Files

- `bucket-policy.json` — public `s3:GetObject` on `dali-os-desktop-releases/*`.
- `iam-put-policy.json` — identity policy for the CI publisher user: `s3:PutObject`
  on `dali-os-desktop-releases/*`. Attach to the IAM user whose keys are the
  `DESKTOP_AWS_ACCESS_KEY_ID` / `DESKTOP_AWS_SECRET_ACCESS_KEY` GitHub secrets.

## Create the releases bucket

```bash
# 1. create (us-east-1 needs no LocationConstraint)
aws s3api create-bucket --bucket dali-os-desktop-releases --region us-east-1

# 2. allow a public *policy* (keep ACLs blocked — we don't use ACLs)
aws s3api put-public-access-block --bucket dali-os-desktop-releases \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false

# 3. public-read policy
aws s3api put-bucket-policy --bucket dali-os-desktop-releases \
  --policy file://bucket-policy.json

# 4. CI publisher permission (attach to the IAM user behind the GitHub secrets)
aws iam put-user-policy --user-name dali-os-desktop-ci \
  --policy-name DesktopReleasesPut --policy-document file://iam-put-policy.json
```

## Re-harden the private uploads bucket

If a public policy was ever applied to `dali-os-uploads-prod`, remove it and turn
Block Public Access fully back on (safe — app uploads use presigned URLs):

```bash
aws s3api delete-bucket-policy --bucket dali-os-uploads-prod
aws s3api put-public-access-block --bucket dali-os-uploads-prod \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Verify

```bash
# releases bucket object is publicly readable (200 after a release run):
curl -I https://dali-os-desktop-releases.s3.us-east-1.amazonaws.com/latest.json
# private uploads bucket is NOT public (403 anonymously):
curl -I https://dali-os-uploads-prod.s3.us-east-1.amazonaws.com/uploads/anything
```
