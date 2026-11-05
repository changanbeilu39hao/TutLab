CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TYPE public.role AS ENUM ('admin', 'teacher', 'manager');
CREATE TYPE public.student_status AS ENUM ('active', 'paused', 'churned');
CREATE TYPE public.session_status AS ENUM ('planned', 'done', 'cancelled');
CREATE TYPE public.attendance_kind AS ENUM ('present', 'absent', 'leave', 'trial');
CREATE TYPE public.mastery_level AS ENUM ('none', 'partial', 'solid', 'unknown');
CREATE TYPE public.ledger_reason AS ENUM ('purchase', 'deduct', 'refund', 'adjust');
CREATE TYPE public.concern_level AS ENUM ('watch', 'risk');
CREATE TYPE public.raw_status AS ENUM ('parsed', 'fallback', 'failed');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.role NOT NULL,
  display_name text NOT NULL,
  campus text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  wechat text
);

CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  year_level integer NOT NULL,
  parent_id uuid NOT NULL REFERENCES public.parents(id),
  service_owner_id uuid NOT NULL REFERENCES public.profiles(id),
  status public.student_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  level text NOT NULL
);

CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  course_id uuid NOT NULL REFERENCES public.courses(id),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id),
  campus text NOT NULL,
  capacity integer NOT NULL,
  term_id text NOT NULL
);

CREATE TABLE public.class_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  weekday smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL
);

CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status public.session_status NOT NULL DEFAULT 'planned'
);

CREATE TABLE public.session_students (
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  is_new boolean NOT NULL DEFAULT false,
  is_trial boolean NOT NULL DEFAULT false,
  CONSTRAINT session_students_pkey PRIMARY KEY (session_id, student_id)
);

CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status public.attendance_kind NOT NULL,
  credits_deducted integer NOT NULL DEFAULT 0,
  marked_by uuid NOT NULL REFERENCES public.profiles(id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  remark text
);

CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason public.ledger_reason NOT NULL,
  ref_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feedback_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id),
  raw_text text NOT NULL,
  model text NOT NULL,
  status public.raw_status NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.student_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_raw_id uuid NOT NULL REFERENCES public.feedback_raw(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  mastery public.mastery_level NOT NULL,
  observation text NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.student_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_raw_id uuid NOT NULL REFERENCES public.feedback_raw(id) ON DELETE CASCADE,
  covered text[] NOT NULL DEFAULT '{}',
  homework text,
  class_note text
);

CREATE TABLE public.parent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_raw_id uuid NOT NULL REFERENCES public.feedback_raw(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'draft'
);

CREATE TABLE public.concerns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  level public.concern_level NOT NULL,
  reason text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.impersonation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  subject_id uuid NOT NULL REFERENCES public.profiles(id),
  token_jti uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE INDEX credit_ledger_student_latest_idx
  ON public.credit_ledger (student_id, created_at DESC, id DESC);
CREATE INDEX session_students_student_idx
  ON public.session_students (student_id, session_id);
CREATE INDEX sessions_teacher_time_idx
  ON public.sessions (teacher_id, starts_at, ends_at);
