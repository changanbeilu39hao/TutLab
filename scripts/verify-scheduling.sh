#!/usr/bin/env bash
set -euo pipefail

eval "$(corepack pnpm supabase status -o env)"
API=http://127.0.0.1:8787
login() {
  curl -fsS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"Passw0rd!\"}" | jq -r .access_token
}
KIKI=$(login kiki@tutlab.local)
JASON=$(login jason@tutlab.local)
BOSS=$(login boss@tutlab.local)
KEVIN=$(login kevin@tutlab.local)
LISA=$(login lisa@tutlab.local)

[ "$(curl -fsS -H "Authorization: Bearer $KIKI" "$API/api/students" | jq '.items|length')" = 22 ]
[ "$(curl -fsS -H "Authorization: Bearer $JASON" "$API/api/students" | jq '.items|length')" = 14 ]
[ "$(curl -fsS -H "Authorization: Bearer $BOSS" "$API/api/students" | jq '.items|length')" = 36 ]
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEVIN" "$API/api/students")
[ "$CODE" = 403 ]
echo 'PASS student ownership and role checks'

FROM=$(TZ=Australia/Melbourne date +%F)
TO=$(TZ=Australia/Melbourne date -v+7d +%F)
KCAL=$(curl -fsS -H "Authorization: Bearer $KEVIN" "$API/api/schedule?from=$FROM&to=$TO")
LCAL=$(curl -fsS -H "Authorization: Bearer $LISA" "$API/api/schedule?from=$FROM&to=$TO")
[ "$(printf '%s' "$KCAL" | jq '.classes|length')" = 6 ]
[ "$(printf '%s' "$KCAL" | jq '.sessions|length')" = "$(printf '%s' "$LCAL" | jq '.sessions|length')" ]
echo 'PASS shared calendar for all teachers'

START=$(TZ=Australia/Melbourne date -v+2d -v10H -v0M -v0S '+%Y-%m-%dT10:00:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
END=$(TZ=Australia/Melbourne date -v+2d -v11H -v30M -v0S '+%Y-%m-%dT11:30:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
TRIAL=$(curl -fsS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"trial\",\"class_id\":\"00000000-0000-4000-8000-000000000201\",\"student_id\":\"00000000-0000-4000-8000-000000001003\",\"starts_at\":\"$START\",\"ends_at\":\"$END\"}")
TRIAL_ID=$(printf '%s' "$TRIAL" | jq -r .session_id)
[ -n "$TRIAL_ID" ] && [ "$TRIAL_ID" != null ]
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT is_trial FROM public.session_students WHERE session_id='$TRIAL_ID' AND student_id='00000000-0000-4000-8000-000000001003';")" = t ]
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT count(*) FROM public.session_students WHERE session_id='$TRIAL_ID';")" = 1 ]
echo 'PASS new trial contains only the selected student'

START2=$(TZ=Australia/Melbourne date -v+3d -v10H -v0M -v0S '+%Y-%m-%dT10:00:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
END2=$(TZ=Australia/Melbourne date -v+3d -v11H -v30M -v0S '+%Y-%m-%dT11:30:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
DUP=$(curl -sS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"trial\",\"class_id\":\"00000000-0000-4000-8000-000000000201\",\"student_id\":\"00000000-0000-4000-8000-000000001003\",\"starts_at\":\"$START2\",\"ends_at\":\"$END2\"}")
[ "$(printf '%s' "$DUP" | jq -r '.error.code')" = VALIDATION_FAILED ]
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $JASON" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"trial\",\"class_id\":\"00000000-0000-4000-8000-000000000201\",\"student_id\":\"00000000-0000-4000-8000-000000001003\",\"starts_at\":\"$START2\",\"ends_at\":\"$END2\"}")
[ "$CODE" = 403 ]
echo 'PASS one-trial-only and admin student ownership'

COURSE=$(curl -fsS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"course\",\"class_id\":\"00000000-0000-4000-8000-000000000203\",\"student_id\":\"00000000-0000-4000-8000-000000001004\",\"starts_at\":\"$START2\",\"ends_at\":\"$END2\"}")
COURSE_ID=$(printf '%s' "$COURSE" | jq -r .session_id)
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT concat_ws(':',is_new,is_trial) FROM public.session_students WHERE session_id='$COURSE_ID' AND student_id='00000000-0000-4000-8000-000000001004';")" = 't:f' ]
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT count(*) FROM public.enrollments WHERE class_id='00000000-0000-4000-8000-000000000203' AND student_id='00000000-0000-4000-8000-000000001004' AND status='active';")" = 1 ]
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT count(*) FROM public.session_students WHERE session_id='$COURSE_ID';")" = 1 ]
echo 'PASS selected-student course contains only that student'

START4=$(TZ=Australia/Melbourne date -v+4d -v10H -v0M -v0S '+%Y-%m-%dT10:00:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
END4=$(TZ=Australia/Melbourne date -v+4d -v11H -v30M -v0S '+%Y-%m-%dT11:30:00%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
WHOLE_CLASS=$(curl -fsS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"course\",\"class_id\":\"00000000-0000-4000-8000-000000000202\",\"starts_at\":\"$START4\",\"ends_at\":\"$END4\"}")
WHOLE_CLASS_ID=$(printf '%s' "$WHOLE_CLASS" | jq -r .session_id)
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT count(*) FROM public.session_students WHERE session_id='$WHOLE_CLASS_ID';")" = 6 ]
echo 'PASS no-student course contains the whole class'

JOINED=$(curl -fsS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/sessions/$COURSE_ID/trial" \
  -d '{"student_id":"00000000-0000-4000-8000-000000001005"}')
[ "$(printf '%s' "$JOINED" | jq -r .session_id)" = "$COURSE_ID" ]
[ "$(docker exec supabase_db_tutlab psql -U postgres -d postgres -Atc "SELECT count(*) FROM public.session_students WHERE session_id='$COURSE_ID';")" = 2 ]
DUPLICATE_JOIN=$(curl -sS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/sessions/$COURSE_ID/trial" \
  -d '{"student_id":"00000000-0000-4000-8000-000000001005"}')
[ "$(printf '%s' "$DUPLICATE_JOIN" | jq -r '.error.code')" = VALIDATION_FAILED ]
LOCKED_JOIN=$(curl -sS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/sessions/00000000-0000-4000-8000-000000004004/trial" \
  -d '{"student_id":"00000000-0000-4000-8000-000000001006"}')
[ "$(printf '%s' "$LOCKED_JOIN" | jq -r '.error.code')" = VALIDATION_FAILED ]
echo 'PASS join-trial updates an existing session only'

CONFLICT=$(curl -sS -X POST -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/schedule" \
  -d "{\"kind\":\"course\",\"class_id\":\"00000000-0000-4000-8000-000000000203\",\"starts_at\":\"$START2\",\"ends_at\":\"$END2\"}")
[ "$(printf '%s' "$CONFLICT" | jq -r '.error.code')" = VALIDATION_FAILED ]
echo 'PASS teacher overlap rejection'

[ "$(curl -fsS -H "Authorization: Bearer $BOSS" "$API/api/concerns" | jq -r '.items[]|select(.id=="balance:00000000-0000-4000-8000-000000001036")|(.dynamic|tostring)+":"+.level')" = 'true:risk' ]
[ "$(curl -fsS -H "Authorization: Bearer $KIKI" "$API/api/concerns" | jq '[.items[]|select(.id=="balance:00000000-0000-4000-8000-000000001036")]|length')" = 0 ]
docker exec supabase_db_tutlab psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "INSERT INTO public.credit_ledger(student_id,delta,reason,balance_after) VALUES ('00000000-0000-4000-8000-000000001006',-17,'adjust',3);" >/dev/null
[ "$(curl -fsS -H "Authorization: Bearer $KIKI" "$API/api/concerns" | jq -r '.items[]|select(.id=="balance:00000000-0000-4000-8000-000000001006")|(.dynamic|tostring)+":"+.level')" = 'true:watch' ]
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $KIKI" -H 'content-type: application/json' "$API/api/concerns/balance:00000000-0000-4000-8000-000000001006" -d '{"resolved":true}')
[ "$CODE" = 404 ]
echo 'PASS dynamic low-balance concerns and read-only behavior'
echo 'ALL SCHEDULING API CHECKS PASSED'
