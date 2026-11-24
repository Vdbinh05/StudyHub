import type {
  AllocationStrategy,
  AnswerMatchMode,
  CoverageAttemptStatus,
  CoverageCycleStatus,
  CoverageQuestionState,
  DifficultyLevel,
  ExamAcceptedAnswerSnapshot,
  ExamConfig,
  ExamQuestionType,
  ExamSnapshotOption,
  ExamSourceType,
  ExamStatus,
  ExamTagSnapshot,
  FriendshipStatus,
  ImportJobStatus,
  Locale,
  MasteryLevel,
  MemberRole,
  QuestionType,
  SelectionPolicy,
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
 * Typed Supabase PostgreSQL schema matching all 26 canonical tables in migrations `0001`–`0005`.
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
          is_favorite: boolean;
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
          is_favorite?: boolean;
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
          is_favorite?: boolean;
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
          allow_clone: boolean;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          user_id: string;
          role?: MemberRole;
          allow_clone?: boolean;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          role?: MemberRole;
          allow_clone?: boolean;
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
          study_set_id: string | null;
          source_study_set_ids: string[];
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
          study_set_id?: string | null;
          source_study_set_ids?: string[];
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
      exam_presets: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          is_favorite: boolean;
          requested_question_count: number | null;
          allocation_strategy: AllocationStrategy;
          selection_policy: SelectionPolicy;
          full_coverage_mode: boolean;
          duration_limit_seconds: number | null;
          pass_threshold: number;
          shuffle_questions: boolean;
          shuffle_options: boolean;
          show_subject_names: boolean;
          show_chapter_names: boolean;
          allow_navigation: boolean;
          allow_mark_for_review: boolean;
          auto_submit_on_expire: boolean;
          show_review_after_submit: boolean;
          filters: Json;
          use_count: number;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          is_favorite?: boolean;
          requested_question_count?: number | null;
          allocation_strategy?: AllocationStrategy;
          selection_policy?: SelectionPolicy;
          full_coverage_mode?: boolean;
          duration_limit_seconds?: number | null;
          pass_threshold?: number;
          shuffle_questions?: boolean;
          shuffle_options?: boolean;
          show_subject_names?: boolean;
          show_chapter_names?: boolean;
          allow_navigation?: boolean;
          allow_mark_for_review?: boolean;
          auto_submit_on_expire?: boolean;
          show_review_after_submit?: boolean;
          filters?: Json;
          use_count?: number;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          is_favorite?: boolean;
          requested_question_count?: number | null;
          allocation_strategy?: AllocationStrategy;
          selection_policy?: SelectionPolicy;
          full_coverage_mode?: boolean;
          duration_limit_seconds?: number | null;
          pass_threshold?: number;
          shuffle_questions?: boolean;
          shuffle_options?: boolean;
          show_subject_names?: boolean;
          show_chapter_names?: boolean;
          allow_navigation?: boolean;
          allow_mark_for_review?: boolean;
          auto_submit_on_expire?: boolean;
          show_review_after_submit?: boolean;
          filters?: Json;
          use_count?: number;
          last_used_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_presets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_preset_sources: {
        Row: {
          id: string;
          preset_id: string;
          source_type: ExamSourceType;
          study_set_id: string | null;
          folder_id: string | null;
          include_subfolders: boolean;
          custom_count: number | null;
          custom_percentage: number | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          preset_id: string;
          source_type: ExamSourceType;
          study_set_id?: string | null;
          folder_id?: string | null;
          include_subfolders?: boolean;
          custom_count?: number | null;
          custom_percentage?: number | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          source_type?: ExamSourceType;
          study_set_id?: string | null;
          folder_id?: string | null;
          include_subfolders?: boolean;
          custom_count?: number | null;
          custom_percentage?: number | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "exam_preset_sources_preset_id_fkey";
            columns: ["preset_id"];
            isOneToOne: false;
            referencedRelation: "exam_presets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_preset_sources_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_preset_sources_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      coverage_cycles: {
        Row: {
          id: string;
          user_id: string;
          preset_id: string | null;
          title: string;
          status: CoverageCycleStatus;
          source_snapshot: Json;
          filter_snapshot: Json;
          allocation_strategy: AllocationStrategy;
          questions_per_exam: number;
          total_questions: number;
          assigned_count: number;
          answered_count: number;
          completed_count: number;
          active_attempt_id: string | null;
          cycle_number: number;
          started_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          preset_id?: string | null;
          title: string;
          status?: CoverageCycleStatus;
          source_snapshot?: Json;
          filter_snapshot?: Json;
          allocation_strategy?: AllocationStrategy;
          questions_per_exam: number;
          total_questions: number;
          assigned_count?: number;
          answered_count?: number;
          completed_count?: number;
          active_attempt_id?: string | null;
          cycle_number?: number;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          status?: CoverageCycleStatus;
          source_snapshot?: Json;
          filter_snapshot?: Json;
          allocation_strategy?: AllocationStrategy;
          questions_per_exam?: number;
          total_questions?: number;
          assigned_count?: number;
          answered_count?: number;
          completed_count?: number;
          active_attempt_id?: string | null;
          cycle_number?: number;
          completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coverage_cycles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycles_preset_id_fkey";
            columns: ["preset_id"];
            isOneToOne: false;
            referencedRelation: "exam_presets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycles_active_attempt_id_fkey";
            columns: ["active_attempt_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      coverage_cycle_questions: {
        Row: {
          id: string;
          cycle_id: string;
          user_id: string;
          question_id: string | null;
          source_study_set_id: string | null;
          source_subject_title: string;
          pool_order: number;
          state: CoverageQuestionState;
          assigned_attempt_id: string | null;
          completed_attempt_id: string | null;
          was_answered: boolean;
          last_is_correct: boolean | null;
          times_assigned: number;
          assigned_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          user_id: string;
          question_id?: string | null;
          source_study_set_id?: string | null;
          source_subject_title: string;
          pool_order: number;
          state?: CoverageQuestionState;
          assigned_attempt_id?: string | null;
          completed_attempt_id?: string | null;
          was_answered?: boolean;
          last_is_correct?: boolean | null;
          times_assigned?: number;
          assigned_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          pool_order?: number;
          state?: CoverageQuestionState;
          assigned_attempt_id?: string | null;
          completed_attempt_id?: string | null;
          was_answered?: boolean;
          last_is_correct?: boolean | null;
          times_assigned?: number;
          assigned_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coverage_cycle_questions_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "coverage_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycle_questions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycle_questions_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      coverage_cycle_attempts: {
        Row: {
          id: string;
          cycle_id: string;
          attempt_id: string;
          user_id: string;
          sequence_number: number;
          status: CoverageAttemptStatus;
          assigned_question_count: number;
          answered_question_count: number;
          completed_question_count: number;
          discarded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          attempt_id: string;
          user_id: string;
          sequence_number: number;
          status?: CoverageAttemptStatus;
          assigned_question_count: number;
          answered_question_count?: number;
          completed_question_count?: number;
          discarded_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: CoverageAttemptStatus;
          answered_question_count?: number;
          completed_question_count?: number;
          discarded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coverage_cycle_attempts_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "coverage_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycle_attempts_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_cycle_attempts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
          allocation_strategy: AllocationStrategy;
          selection_policy: SelectionPolicy;
          requested_question_count: number | null;
          show_subject_names: boolean;
          show_chapter_names: boolean;
          allow_navigation: boolean;
          allow_mark_for_review: boolean;
          auto_submit_on_expire: boolean;
          show_review_after_submit: boolean;
          coverage_cycle_id: string | null;
          preset_id: string | null;
          is_multi_subject: boolean;
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
          allocation_strategy?: AllocationStrategy;
          selection_policy?: SelectionPolicy;
          requested_question_count?: number | null;
          show_subject_names?: boolean;
          show_chapter_names?: boolean;
          allow_navigation?: boolean;
          allow_mark_for_review?: boolean;
          auto_submit_on_expire?: boolean;
          show_review_after_submit?: boolean;
          coverage_cycle_id?: string | null;
          preset_id?: string | null;
          is_multi_subject?: boolean;
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
          {
            foreignKeyName: "exam_attempts_coverage_cycle_id_fkey";
            columns: ["coverage_cycle_id"];
            isOneToOne: false;
            referencedRelation: "coverage_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempts_preset_id_fkey";
            columns: ["preset_id"];
            isOneToOne: false;
            referencedRelation: "exam_presets";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_attempt_sources: {
        Row: {
          id: string;
          attempt_id: string;
          user_id: string;
          source_type: ExamSourceType;
          study_set_id: string | null;
          folder_id: string | null;
          subject_title_snapshot: string;
          eligible_count: number;
          requested_count: number | null;
          requested_percentage: number | null;
          allocated_count: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          user_id: string;
          source_type?: ExamSourceType;
          study_set_id?: string | null;
          folder_id?: string | null;
          subject_title_snapshot: string;
          eligible_count?: number;
          requested_count?: number | null;
          requested_percentage?: number | null;
          allocated_count?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "exam_attempt_sources_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "exam_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_attempt_sources_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
          source_study_set_id: string | null;
          source_subject_title: string | null;
          chapter_snapshot: string | null;
          tags_snapshot: ExamTagSnapshot[];
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
          source_study_set_id?: string | null;
          source_subject_title?: string | null;
          chapter_snapshot?: string | null;
          tags_snapshot?: ExamTagSnapshot[];
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
          {
            foreignKeyName: "exam_attempt_questions_source_study_set_id_fkey";
            columns: ["source_study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
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
          client_seq: number;
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
          client_seq?: number;
          updated_at?: string;
        };
        Update: {
          selected_option_ids?: string[];
          typed_answer?: string | null;
          is_flagged?: boolean;
          is_correct?: boolean | null;
          client_seq?: number;
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
          blocked_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: FriendshipStatus;
          blocked_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: FriendshipStatus;
          blocked_by?: string | null;
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
          {
            foreignKeyName: "friendships_blocked_by_fkey";
            columns: ["blocked_by"];
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
      get_my_profile: {
        Args: Record<string, never>;
        Returns: Json;
      };
      resolve_deduped_study_sets: {
        Args: {
          p_folder_ids: string[];
          p_study_set_ids: string[];
          p_include_subfolders?: boolean;
        };
        Returns: Array<{
          study_set_id: string;
          title: string;
          subject: string | null;
          question_count: number;
        }>;
      };
      get_exam_eligible_pool: {
        Args: {
          p_folder_ids: string[];
          p_study_set_ids: string[];
          p_include_subfolders?: boolean;
          p_filters?: Json;
          p_selection_policy?: string;
        };
        Returns: Json;
      };
      create_exam_attempt_v2: {
        Args: {
          p_title_snapshot: string;
          p_primary_study_set_id: string | null;
          p_sources: Json;
          p_selected_items: Json;
          p_config: Json;
          p_duration_limit_seconds: number | null;
          p_pass_threshold: number;
          p_allocation_strategy?: string;
          p_selection_policy?: string;
          p_requested_question_count?: number | null;
          p_show_subject_names?: boolean;
          p_show_chapter_names?: boolean;
          p_allow_navigation?: boolean;
          p_allow_mark_for_review?: boolean;
          p_auto_submit_on_expire?: boolean;
          p_show_review_after_submit?: boolean;
          p_preset_id?: string | null;
          p_coverage_cycle_id?: string | null;
        };
        Returns: Json;
      };
      save_exam_attempt_answers: {
        Args: {
          p_attempt_id: string;
          p_answers: Json;
        };
        Returns: Json;
      };
      submit_exam_attempt: {
        Args: { p_attempt_id: string };
        Returns: Json;
      };
      get_exam_attempt_detail: {
        Args: { p_attempt_id: string };
        Returns: Json;
      };
      create_coverage_cycle: {
        Args: {
          p_title: string;
          p_source_snapshot: Json;
          p_filter_snapshot: Json;
          p_allocation_strategy: string;
          p_questions_per_exam: number;
          p_pool_items: Json;
          p_preset_id?: string | null;
        };
        Returns: Json;
      };
      issue_coverage_cycle_next_exam: {
        Args: {
          p_cycle_id: string;
          p_selected_items: Json;
          p_sources: Json;
          p_title_snapshot: string;
          p_config: Json;
          p_duration_limit_seconds: number | null;
          p_pass_threshold: number;
          p_show_subject_names?: boolean;
          p_show_chapter_names?: boolean;
          p_allow_navigation?: boolean;
          p_allow_mark_for_review?: boolean;
          p_auto_submit_on_expire?: boolean;
          p_show_review_after_submit?: boolean;
        };
        Returns: Json;
      };
      discard_coverage_cycle_active_exam: {
        Args: { p_cycle_id: string };
        Returns: Json;
      };
      restart_coverage_cycle: {
        Args: {
          p_cycle_id: string;
          p_new_pool_items?: Json | null;
          p_force_discard_active?: boolean;
        };
        Returns: Json;
      };
      get_coverage_cycle_subject_progress: {
        Args: {
          p_cycle_ids: string[];
        };
        Returns: Array<{
          cycle_id: string;
          study_set_id: string | null;
          subject_title: string;
          total: number;
          completed: number;
          assigned: number;
          remaining: number;
        }>;
      };
      clone_study_set: {
        Args: {
          p_source_set_id: string;
          p_title?: string | null;
          p_folder_id?: string | null;
        };
        Returns: Json;
      };
      get_practice_question_pool: {
        Args: {
          p_folder_ids: string[];
          p_study_set_ids: string[];
          p_include_subfolders?: boolean;
          p_filters?: Json;
          p_selection_policy?: string;
          p_count?: number | null;
          p_shuffle?: boolean;
        };
        Returns: Json;
      };
      preview_share_link: {
        Args: { p_token: string };
        Returns: Json;
      };
      redeem_share_link: {
        Args: { p_token: string };
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
