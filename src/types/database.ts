import type {
  AnswerMatchMode,
  DifficultyLevel,
  ExamAcceptedAnswerSnapshot,
  ExamConfig,
  ExamQuestionType,
  ExamSnapshotOption,
  ExamStatus,
  FriendshipStatus,
  ImportJobStatus,
  Locale,
  MasteryLevel,
  MemberRole,
  QuestionType,
  SelfRating,
  SessionStatus,
  SharePermission,
  StudyMode,
  StudySetType,
  ThemePreference,
  Visibility,
} from "./domain";
import type { ImportFormat } from "./import";

/**
 * Typed Supabase PostgreSQL schema matching all 20 canonical tables in `docs/DATABASE.md`.
 * Compatible with `@supabase/supabase-js` v2 generic client typing.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name: string;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          display_name?: string;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          user_id: string;
          language: Locale;
          theme: ThemePreference;
          daily_goal: number;
          default_shuffle_questions: boolean;
          default_shuffle_options: boolean;
          show_instant_feedback: boolean;
          sound_effects: boolean;
          reduced_motion: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          language?: Locale;
          theme?: ThemePreference;
          daily_goal?: number;
          default_shuffle_questions?: boolean;
          default_shuffle_options?: boolean;
          show_instant_feedback?: boolean;
          sound_effects?: boolean;
          reduced_motion?: boolean;
          updated_at?: string;
        };
        Update: {
          language?: Locale;
          theme?: ThemePreference;
          daily_goal?: number;
          default_shuffle_questions?: boolean;
          default_shuffle_options?: boolean;
          show_instant_feedback?: boolean;
          sound_effects?: boolean;
          reduced_motion?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          id: string;
          owner_id: string;
          parent_id: string | null;
          name: string;
          description: string | null;
          color: string;
          icon: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          parent_id?: string | null;
          name: string;
          description?: string | null;
          color?: string;
          icon?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          parent_id?: string | null;
          name?: string;
          description?: string | null;
          color?: string;
          icon?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sets: {
        Row: {
          id: string;
          owner_id: string;
          folder_id: string | null;
          title: string;
          description: string | null;
          subject: string | null;
          set_type: StudySetType;
          visibility: Visibility;
          source_language: string;
          question_count: number;
          default_exam_duration_minutes: number;
          default_pass_threshold: number;
          is_archived: boolean;
          last_studied_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          folder_id?: string | null;
          title: string;
          description?: string | null;
          subject?: string | null;
          set_type?: StudySetType;
          visibility?: Visibility;
          source_language?: string;
          question_count?: number;
          default_exam_duration_minutes?: number;
          default_pass_threshold?: number;
          is_archived?: boolean;
          last_studied_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          folder_id?: string | null;
          title?: string;
          description?: string | null;
          subject?: string | null;
          set_type?: StudySetType;
          visibility?: Visibility;
          source_language?: string;
          question_count?: number;
          default_exam_duration_minutes?: number;
          default_pass_threshold?: number;
          is_archived?: boolean;
          last_studied_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_sets_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sets_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      study_set_members: {
        Row: {
          id: string;
          study_set_id: string;
          user_id: string;
          role: MemberRole;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          user_id: string;
          role?: MemberRole;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          role?: MemberRole;
        };
        Relationships: [
          {
            foreignKeyName: "study_set_members_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_set_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      study_set_share_links: {
        Row: {
          id: string;
          study_set_id: string;
          created_by: string;
          token: string;
          permission: SharePermission;
          allow_clone: boolean;
          expires_at: string | null;
          revoked_at: string | null;
          use_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          created_by: string;
          token: string;
          permission?: SharePermission;
          allow_clone?: boolean;
          expires_at?: string | null;
          revoked_at?: string | null;
          use_count?: number;
          created_at?: string;
        };
        Update: {
          permission?: SharePermission;
          allow_clone?: boolean;
          expires_at?: string | null;
          revoked_at?: string | null;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "study_set_share_links_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_set_share_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          id: string;
          study_set_id: string;
          question_type: QuestionType;
          position: number;
          chapter: string | null;
          prompt: string;
          prompt_image_url: string | null;
          back_text: string | null;
          back_image_url: string | null;
          explanation: string | null;
          hint: string | null;
          difficulty: DifficultyLevel;
          source_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          question_type?: QuestionType;
          position?: number;
          chapter?: string | null;
          prompt: string;
          prompt_image_url?: string | null;
          back_text?: string | null;
          back_image_url?: string | null;
          explanation?: string | null;
          hint?: string | null;
          difficulty?: DifficultyLevel;
          source_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          question_type?: QuestionType;
          position?: number;
          chapter?: string | null;
          prompt?: string;
          prompt_image_url?: string | null;
          back_text?: string | null;
          back_image_url?: string | null;
          explanation?: string | null;
          hint?: string | null;
          difficulty?: DifficultyLevel;
          source_metadata?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      question_options: {
        Row: {
          id: string;
          question_id: string;
          study_set_id: string;
          position: number;
          label: string;
          content: string;
          image_url: string | null;
          is_correct: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          study_set_id: string;
          position?: number;
          label: string;
          content: string;
          image_url?: string | null;
          is_correct?: boolean;
          created_at?: string;
        };
        Update: {
          position?: number;
          label?: string;
          content?: string;
          image_url?: string | null;
          is_correct?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_options_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      question_accepted_answers: {
        Row: {
          id: string;
          question_id: string;
          study_set_id: string;
          answer_text: string;
          normalized_answer: string;
          match_mode: AnswerMatchMode;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          study_set_id: string;
          answer_text: string;
          normalized_answer: string;
          match_mode?: AnswerMatchMode;
          created_at?: string;
        };
        Update: {
          answer_text?: string;
          normalized_answer?: string;
          match_mode?: AnswerMatchMode;
        };
        Relationships: [
          {
            foreignKeyName: "question_accepted_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_accepted_answers_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          slug: string;
          color?: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          color?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tags_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      question_tags: {
        Row: {
          question_id: string;
          tag_id: string;
          study_set_id: string;
          created_at: string;
        };
        Insert: {
          question_id: string;
          tag_id: string;
          study_set_id: string;
          created_at?: string;
        };
        Update: {
          question_id?: string;
          tag_id?: string;
          study_set_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_tags_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_tags_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      user_question_progress: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          mastery_level: MasteryLevel;
          correct_count: number;
          wrong_count: number;
          consecutive_correct: number;
          ease_factor: number;
          interval_days: number;
          repetitions: number;
          last_reviewed_at: string | null;
          next_review_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          mastery_level?: MasteryLevel;
          correct_count?: number;
          wrong_count?: number;
          consecutive_correct?: number;
          ease_factor?: number;
          interval_days?: number;
          repetitions?: number;
          last_reviewed_at?: string | null;
          next_review_at?: string | null;
          updated_at?: string;
        };
        Update: {
          mastery_level?: MasteryLevel;
          correct_count?: number;
          wrong_count?: number;
          consecutive_correct?: number;
          ease_factor?: number;
          interval_days?: number;
          repetitions?: number;
          last_reviewed_at?: string | null;
          next_review_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_question_progress_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_question_progress_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_question_progress_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      starred_questions: {
        Row: {
          user_id: string;
          question_id: string;
          study_set_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          question_id: string;
          study_set_id: string;
          created_at?: string;
        };
        Update: {
          study_set_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "starred_questions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "starred_questions_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "starred_questions_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string;
          mode: StudyMode;
          status: SessionStatus;
          config: Json;
          total_items: number;
          completed_items: number;
          correct_items: number;
          duration_seconds: number;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id: string;
          mode: StudyMode;
          status?: SessionStatus;
          config?: Json;
          total_items?: number;
          completed_items?: number;
          correct_items?: number;
          duration_seconds?: number;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: SessionStatus;
          config?: Json;
          total_items?: number;
          completed_items?: number;
          correct_items?: number;
          duration_seconds?: number;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      study_session_answers: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          selected_option_ids: string[];
          typed_answer: string | null;
          is_correct: boolean;
          self_rating: SelfRating | null;
          response_time_ms: number | null;
          answered_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          selected_option_ids?: string[];
          typed_answer?: string | null;
          is_correct: boolean;
          self_rating?: SelfRating | null;
          response_time_ms?: number | null;
          answered_at?: string;
        };
        Update: {
          selected_option_ids?: string[];
          typed_answer?: string | null;
          is_correct?: boolean;
          self_rating?: SelfRating | null;
          response_time_ms?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_session_answers_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_session_answers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_session_answers_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_session_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_attempts: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string | null;
          study_set_title_snapshot: string;
          status: ExamStatus;
          config: ExamConfig;
          total_questions: number;
          answered_count: number;
          correct_count: number;
          wrong_count: number;
          unanswered_count: number;
          score_percent: number;
          pass_threshold: number;
          passed: boolean;
          duration_limit_seconds: number | null;
          time_spent_seconds: number;
          started_at: string;
          expires_at: string | null;
          submitted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id?: string | null;
          study_set_title_snapshot: string;
          status?: ExamStatus;
          config?: ExamConfig;
          total_questions: number;
          answered_count?: number;
          correct_count?: number;
          wrong_count?: number;
          unanswered_count?: number;
          score_percent?: number;
          pass_threshold?: number;
          passed?: boolean;
          duration_limit_seconds?: number | null;
          time_spent_seconds?: number;
          started_at?: string;
          expires_at?: string | null;
          submitted_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: ExamStatus;
          answered_count?: number;
          correct_count?: number;
          wrong_count?: number;
          unanswered_count?: number;
          score_percent?: number;
          passed?: boolean;
          time_spent_seconds?: number;
          submitted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exam_attempts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempts_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_attempt_questions: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string | null;
          position: number;
          question_type: ExamQuestionType;
          chapter_snapshot: string | null;
          prompt_snapshot: string;
          prompt_image_url_snapshot: string | null;
          explanation_snapshot: string | null;
          options_snapshot: ExamSnapshotOption[];
          correct_option_ids: string[];
          accepted_answers_snapshot: ExamAcceptedAnswerSnapshot[];
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          question_id?: string | null;
          position: number;
          question_type: ExamQuestionType;
          chapter_snapshot?: string | null;
          prompt_snapshot: string;
          prompt_image_url_snapshot?: string | null;
          explanation_snapshot?: string | null;
          options_snapshot?: ExamSnapshotOption[];
          correct_option_ids?: string[];
          accepted_answers_snapshot?: ExamAcceptedAnswerSnapshot[];
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "exam_attempt_questions_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempt_questions_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          attempt_question_id: string;
          user_id: string;
          selected_option_ids: string[];
          typed_answer: string | null;
          is_flagged: boolean;
          is_correct: boolean | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          attempt_question_id: string;
          user_id: string;
          selected_option_ids?: string[];
          typed_answer?: string | null;
          is_flagged?: boolean;
          is_correct?: boolean | null;
          updated_at?: string;
        };
        Update: {
          selected_option_ids?: string[];
          typed_answer?: string | null;
          is_flagged?: boolean;
          is_correct?: boolean | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_attempt_answers_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempt_answers_attempt_question_id_fkey";
            columns: ["attempt_question_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempt_questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempt_answers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: FriendshipStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: FriendshipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: FriendshipStatus;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      import_jobs: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string | null;
          source_format: ImportFormat;
          file_name: string;
          file_size_bytes: number;
          status: ImportJobStatus;
          total_detected: number;
          valid_count: number;
          warning_count: number;
          error_count: number;
          imported_count: number;
          answer_rule: Json;
          diagnostics: Json;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id?: string | null;
          source_format: ImportFormat;
          file_name: string;
          file_size_bytes: number;
          status?: ImportJobStatus;
          total_detected?: number;
          valid_count?: number;
          warning_count?: number;
          error_count?: number;
          imported_count?: number;
          answer_rule?: Json;
          diagnostics?: Json;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          study_set_id?: string | null;
          status?: ImportJobStatus;
          total_detected?: number;
          valid_count?: number;
          warning_count?: number;
          error_count?: number;
          imported_count?: number;
          answer_rule?: Json;
          diagnostics?: Json;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "import_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_jobs_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_read_study_set: {
        Args: { p_set_id: string; p_user_id: string };
        Returns: boolean;
      };
      can_edit_study_set: {
        Args: { p_set_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_study_set_owner: {
        Args: { p_set_id: string; p_user_id: string };
        Returns: boolean;
      };
      submit_exam_attempt: {
        Args: { p_attempt_id: string };
        Returns: Json;
      };
      find_profile_by_username_or_email: {
        Args: { p_query: string };
        Returns: Array<{
          id: string;
          display_name: string;
          username: string | null;
          avatar_url: string | null;
        }>;
      };
    };
    Enums: {
      study_set_type: StudySetType;
      visibility_level: Visibility;
      member_role: MemberRole;
      share_permission: SharePermission;
      question_type: QuestionType;
      answer_match_mode: AnswerMatchMode;
      difficulty_level: DifficultyLevel;
      mastery_level: MasteryLevel;
      self_rating: SelfRating;
      study_mode: StudyMode;
      session_status: SessionStatus;
      exam_status: ExamStatus;
      friendship_status: FriendshipStatus;
      import_job_status: ImportJobStatus;
      import_format: ImportFormat;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
