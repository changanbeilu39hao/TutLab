CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT role::text FROM public.profiles WHERE id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated, service_role;

DO $rls$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'profiles',
    'parents',
    'students',
    'courses',
    'classes',
    'class_slots',
    'enrollments',
    'sessions',
    'session_students',
    'attendance',
    'credit_ledger',
    'feedback_raw',
    'student_feedback',
    'student_notes',
    'parent_messages',
    'concerns',
    'impersonation_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format(
      'CREATE POLICY service_role_manage ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      v_table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table_name);
  END LOOP;
END;
$rls$;

CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_admin_manager_read ON public.profiles
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY parents_admin_manager_manage ON public.parents
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY students_authenticated_read ON public.students
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY students_owner_or_manager_write ON public.students
  FOR ALL TO authenticated
  USING (
    public.current_profile_role() = 'manager'
    OR service_owner_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.current_profile_role() = 'manager'
    OR service_owner_id = (SELECT auth.uid())
  );

CREATE POLICY courses_authenticated_read ON public.courses
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY courses_admin_manager_manage ON public.courses
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY classes_authenticated_read ON public.classes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY classes_admin_manager_manage ON public.classes
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY class_slots_authenticated_read ON public.class_slots
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY class_slots_admin_manager_manage ON public.class_slots
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY enrollments_authenticated_read ON public.enrollments
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY enrollments_admin_manager_manage ON public.enrollments
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY sessions_admin_manager_manage ON public.sessions
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY sessions_teacher_own ON public.sessions
  FOR ALL TO authenticated
  USING (teacher_id = (SELECT auth.uid()))
  WITH CHECK (teacher_id = (SELECT auth.uid()));

CREATE POLICY session_students_admin_manager_manage ON public.session_students
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY session_students_teacher_own ON public.session_students
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = session_students.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = session_students.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY attendance_admin_manager_manage ON public.attendance
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY attendance_teacher_own ON public.attendance
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = attendance.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = attendance.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY credit_ledger_admin_manager_read ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY credit_ledger_teacher_own_students_read ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.session_students ss
        JOIN public.sessions s ON s.id = ss.session_id
       WHERE ss.student_id = credit_ledger.student_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY feedback_raw_admin_manager_read ON public.feedback_raw
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY feedback_raw_teacher_own ON public.feedback_raw
  FOR ALL TO authenticated
  USING (
    teacher_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = feedback_raw.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    teacher_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = feedback_raw.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY student_feedback_admin_manager_read ON public.student_feedback
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY student_feedback_teacher_own ON public.student_feedback
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = student_feedback.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = student_feedback.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY student_notes_admin_manager_read ON public.student_notes
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY student_notes_teacher_own ON public.student_notes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = student_notes.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = student_notes.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY parent_messages_admin_manager_read ON public.parent_messages
  FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY parent_messages_teacher_read ON public.parent_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = parent_messages.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY parent_messages_teacher_insert_draft ON public.parent_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    state = 'draft'
    AND EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = parent_messages.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY parent_messages_teacher_confirm ON public.parent_messages
  FOR UPDATE TO authenticated
  USING (
    state = 'draft'
    AND EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = parent_messages.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = parent_messages.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY parent_messages_teacher_delete_draft ON public.parent_messages
  FOR DELETE TO authenticated
  USING (
    state = 'draft'
    AND EXISTS (
      SELECT 1
        FROM public.feedback_raw fr
        JOIN public.sessions s ON s.id = fr.session_id
       WHERE fr.id = parent_messages.feedback_raw_id
         AND fr.teacher_id = (SELECT auth.uid())
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY concerns_admin_manager_manage ON public.concerns
  FOR ALL TO authenticated
  USING (public.current_profile_role() IN ('admin', 'manager'))
  WITH CHECK (public.current_profile_role() IN ('admin', 'manager'));

CREATE POLICY concerns_teacher_own_students_read ON public.concerns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
       WHERE s.id = concerns.session_id
         AND s.teacher_id = (SELECT auth.uid())
    )
  );

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.courses,
  public.classes,
  public.class_slots,
  public.enrollments,
  public.sessions,
  public.session_students,
  public.attendance
TO authenticated;
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.feedback_raw,
  public.student_feedback,
  public.student_notes,
  public.parent_messages,
  public.concerns
TO authenticated;
