#!/usr/bin/env bash
# One-time / config-change deploy of the API + /admin + /check to Cloud Run (builds from source with Cloud Build).
# Routine code deploys happen automatically on `git push` via .github/workflows/deploy.yml — this script is for changing env/secrets wiring.
set -euo pipefail
PROJECT="${PROJECT:-qiskit-511416}"; REGION="${REGION:-us-east5}"; SERVICE="${SERVICE:-qff-api}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
PUBLIC_URL="${PUBLIC_URL:-$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)}"
PUBLIC_URL="${PUBLIC_URL:-https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app}"

# Web-push keys (for the /user web app on iPhone) are optional: wired in only once the two secrets exist (see docs/WEB-APP.md).
SECRETS="DATABASE_URL=qff-database-url:latest,JWT_SECRET=qff-jwt-secret:latest,SESSION_SECRET=qff-session-secret:latest,OTP_PEPPER=qff-otp-pepper:latest,ADMIN_USERNAME=qff-admin-username:latest,ADMIN_PASSWORD_HASH=qff-admin-password-hash:latest,CHECK_USERNAME=qff-check-username:latest,CHECK_PASSWORD_HASH=qff-check-password-hash:latest,SMTP_ACCOUNTS=qff-smtp-accounts:latest"
if gcloud secrets describe qff-vapid-private --project "$PROJECT" >/dev/null 2>&1 && gcloud secrets describe qff-vapid-public --project "$PROJECT" >/dev/null 2>&1; then
  SECRETS="$SECRETS,VAPID_PRIVATE_KEY=qff-vapid-private:latest,VAPID_PUBLIC_KEY=qff-vapid-public:latest"
fi

cd "$(dirname "$0")"
gcloud run deploy "$SERVICE" --quiet --project "$PROJECT" --region "$REGION" --source . \
  --service-account "qff-run@$PROJECT.iam.gserviceaccount.com" \
  --allow-unauthenticated --min-instances "${MIN_INSTANCES:-1}" --max-instances 3 --concurrency 40 --cpu 1 --memory 512Mi --timeout 30 \
  --set-env-vars "NODE_ENV=production,EVENT_TZ=Asia/Kolkata,MAIL_FROM_NAME=Qiskit Fall Fest,SMTP_DAILY_LIMIT=${SMTP_DAILY_LIMIT:-1900},PUBLIC_URL=$PUBLIC_URL,PHOTO_BUCKET=${PHOTO_BUCKET:-$PROJECT-qff-photos}" \
  --set-secrets "$SECRETS"
echo "URL: $PUBLIC_URL"
