CREATE UNIQUE INDEX enrollments_one_active_per_student_class_idx
  ON public.enrollments (student_id, class_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX session_students_one_trial_per_student_idx
  ON public.session_students (student_id)
  WHERE is_trial;

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

  INSERT INTO public.session_students (
    session_id,
    student_id,
    is_new,
    is_trial
  )
  SELECT
    v_session_id,
    enrollment.student_id,
    p_kind = 'course' AND enrollment.student_id = p_student_id AND v_is_new,
    false
  FROM public.enrollments AS enrollment
  WHERE enrollment.class_id = p_class_id
    AND enrollment.status = 'active'
    AND enrollment.start_date <= (p_starts_at AT TIME ZONE 'Australia/Melbourne')::date
    AND (
      enrollment.end_date IS NULL
      OR enrollment.end_date >= (p_starts_at AT TIME ZONE 'Australia/Melbourne')::date
    );

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
    )
    ON CONFLICT (session_id, student_id) DO UPDATE SET
      is_new = true,
      is_trial = true;
  END IF;

  RETURN v_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_session(text, uuid, uuid, timestamptz, timestamptz) TO service_role;
