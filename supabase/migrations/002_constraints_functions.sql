ALTER TABLE public.class_slots
  ADD CONSTRAINT class_slots_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT class_slots_time_check CHECK (end_time > start_time);

ALTER TABLE public.classes
  ADD CONSTRAINT classes_capacity_check CHECK (capacity > 0);

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_dates_check CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_time_check CHECK (ends_at > starts_at),
  ADD CONSTRAINT sessions_teacher_no_overlap
    EXCLUDE USING gist (teacher_id WITH =, tstzrange(starts_at, ends_at) WITH &&);

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_session_student_unique UNIQUE (session_id, student_id),
  ADD CONSTRAINT attendance_credit_rule_check CHECK (
    (status IN ('present', 'absent') AND credits_deducted = 1)
    OR (status IN ('leave', 'trial') AND credits_deducted = 0)
  );

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_balance_nonnegative CHECK (balance_after >= 0);

ALTER TABLE public.parent_messages
  ADD CONSTRAINT parent_messages_state_check CHECK (state IN ('draft', 'sent'));

ALTER TABLE public.impersonation_log
  ADD CONSTRAINT impersonation_log_expiry_check CHECK (expires_at > started_at);

CREATE OR REPLACE FUNCTION public.mark_attendance(
  p_session_id uuid,
  p_student_id uuid,
  p_status public.attendance_kind,
  p_marked_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_student_id uuid;
  v_attendance_id uuid;
  v_old_status public.attendance_kind;
  v_old_deducted integer;
  v_balance integer;
  v_new_balance integer;
  v_new_deducted integer;
  v_ledger_delta integer;
  v_reason public.ledger_reason;
  v_had_attendance boolean;
BEGIN
  IF p_status IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED';
  END IF;

  SELECT *
    INTO v_session
    FROM public.sessions
   WHERE id = p_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_session.status = 'cancelled'
     OR v_session.ends_at < now() - interval '48 hours' THEN
    RAISE EXCEPTION 'SESSION_LOCKED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.session_students
     WHERE session_id = p_session_id
       AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'NOT_IN_ROSTER';
  END IF;

  -- The student row is the account lock: all attendance calls for one student
  -- serialize here before either the latest balance or attendance is read.
  SELECT id
    INTO v_student_id
    FROM public.students
   WHERE id = p_student_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT balance_after
    INTO v_balance
    FROM public.credit_ledger
   WHERE student_id = p_student_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  v_balance := coalesce(v_balance, 0);

  SELECT id, status, credits_deducted
    INTO v_attendance_id, v_old_status, v_old_deducted
    FROM public.attendance
   WHERE session_id = p_session_id
     AND student_id = p_student_id
   FOR UPDATE;

  v_had_attendance := FOUND;

  -- Repeating the same state is a true no-op, including when the current
  -- balance is now zero. It returns the existing attendance and latest balance.
  IF v_had_attendance AND v_old_status = p_status THEN
    RETURN jsonb_build_object(
      'attendance_id', v_attendance_id,
      'deducted', v_old_deducted,
      'balance_after', v_balance
    );
  END IF;

  v_new_deducted := CASE
    WHEN p_status IN ('present', 'absent') THEN 1
    ELSE 0
  END;
  v_ledger_delta := -(v_new_deducted - coalesce(v_old_deducted, 0));
  v_new_balance := v_balance + v_ledger_delta;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO public.attendance (
    session_id,
    student_id,
    status,
    credits_deducted,
    marked_by,
    marked_at,
    remark
  ) VALUES (
    p_session_id,
    p_student_id,
    p_status,
    v_new_deducted,
    p_marked_by,
    now(),
    NULL
  )
  ON CONFLICT (session_id, student_id) DO UPDATE SET
    status = EXCLUDED.status,
    credits_deducted = EXCLUDED.credits_deducted,
    marked_by = EXCLUDED.marked_by,
    marked_at = EXCLUDED.marked_at,
    remark = public.attendance.remark
  RETURNING id INTO v_attendance_id;

  IF v_ledger_delta <> 0 THEN
    v_reason := CASE WHEN v_had_attendance THEN 'adjust'::public.ledger_reason
                     ELSE 'deduct'::public.ledger_reason END;

    INSERT INTO public.credit_ledger (
      student_id,
      delta,
      reason,
      ref_session_id,
      balance_after,
      created_at
    ) VALUES (
      p_student_id,
      v_ledger_delta,
      v_reason,
      p_session_id,
      v_new_balance,
      clock_timestamp()
    );
  END IF;

  RETURN jsonb_build_object(
    'attendance_id', v_attendance_id,
    'deducted', v_new_deducted,
    'balance_after', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_attendance(uuid, uuid, public.attendance_kind, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance(uuid, uuid, public.attendance_kind, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance(uuid, uuid, public.attendance_kind, uuid) TO service_role;
