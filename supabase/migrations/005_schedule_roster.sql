-- A selected student makes a course session a one-student session. Only a
-- course session without p_student_id copies the class's valid enrollments.
-- Trial sessions always contain just the selected trial student.
CREATE OR REPLACE FUNCTION public.schedule_session(
  p_kind text,
  p_class_id uuid,
  p_student_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_teacher_id uuid;
  v_student_status public.student_status;
  v_session_id uuid;
  v_enrollment_id uuid;
  v_is_new boolean := false;
BEGIN
  IF p_kind IS NULL
     OR p_kind NOT IN ('trial', 'course')
     OR (p_kind = 'trial' AND p_student_id IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  IF p_starts_at IS NULL
     OR p_ends_at IS NULL
     OR p_starts_at <= now()
     OR p_ends_at <= p_starts_at
     OR p_ends_at - p_starts_at < interval '15 minutes'
     OR p_ends_at - p_starts_at > interval '4 hours' THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  SELECT teacher_id
    INTO v_teacher_id
    FROM public.classes
   WHERE id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_student_id IS NOT NULL THEN
    SELECT status
      INTO v_student_status
      FROM public.students
     WHERE id = p_student_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF v_student_status <> 'active' THEN
      RAISE EXCEPTION 'VALIDATION_FAILED';
    END IF;
  END IF;

  IF p_kind = 'course' AND p_student_id IS NOT NULL THEN
    INSERT INTO public.enrollments (
      student_id,
      class_id,
      start_date,
      end_date,
      status
    ) VALUES (
      p_student_id,
      p_class_id,
      CURRENT_DATE,
      NULL,
      'active'
    )
    ON CONFLICT (student_id, class_id) WHERE status = 'active' DO NOTHING
    RETURNING id INTO v_enrollment_id;
    v_is_new := v_enrollment_id IS NOT NULL;
  END IF;

  INSERT INTO public.sessions (
    class_id,
    teacher_id,
    starts_at,
    ends_at,
    status
  ) VALUES (
    p_class_id,
    v_teacher_id,
    p_starts_at,
    p_ends_at,
    'planned'
  )
  RETURNING id INTO v_session_id;

  IF p_kind = 'trial' THEN
    INSERT INTO public.session_students (
      session_id,
      student_id,
      is_new,
      is_trial
    ) VALUES (
      v_session_id,
      p_student_id,
      true,
      true
    );
  ELSIF p_student_id IS NOT NULL THEN
    INSERT INTO public.session_students (
      session_id,
      student_id,
      is_new,
      is_trial
    ) VALUES (
      v_session_id,
      p_student_id,
      v_is_new,
      false
    );
  ELSE
    INSERT INTO public.session_students (
      session_id,
      student_id,
      is_new,
      is_trial
    )
    SELECT
      v_session_id,
      enrollment.student_id,
      false,
      false
    FROM public.enrollments AS enrollment
    WHERE enrollment.class_id = p_class_id
      AND enrollment.status = 'active'
      AND enrollment.start_date <= (p_starts_at AT TIME ZONE 'Australia/Melbourne')::date
      AND (
        enrollment.end_date IS NULL
        OR enrollment.end_date >= (p_starts_at AT TIME ZONE 'Australia/Melbourne')::date
      );
  END IF;

  RETURN v_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) TO service_role;

-- Adding a trial student changes only the existing session roster. The row
-- locks make the validation and insert atomic with concurrent status changes;
-- the existing roster and one-trial-per-student unique constraints handle
-- concurrent attempts as well.
CREATE OR REPLACE FUNCTION public.add_trial_to_session(
  p_session_id uuid,
  p_student_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session_id uuid;
  v_session_status public.session_status;
  v_starts_at timestamptz;
  v_student_status public.student_status;
BEGIN
  IF p_session_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  SELECT id, status, starts_at
    INTO v_session_id, v_session_status, v_starts_at
    FROM public.sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_session_status <> 'planned' OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  SELECT status
    INTO v_student_status
    FROM public.students
   WHERE id = p_student_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF v_student_status <> 'active' THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.session_students
     WHERE session_id = p_session_id
       AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_ROSTER';
  END IF;

  INSERT INTO public.session_students (
    session_id,
    student_id,
    is_new,
    is_trial
  ) VALUES (
    p_session_id,
    p_student_id,
    true,
    true
  );

  RETURN v_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_trial_to_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_trial_to_session(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_trial_to_session(uuid, uuid) TO service_role;
