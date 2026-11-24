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
import type {
  ConfidenceLevel,
  HotspotShape,
  MediaAttachmentRole,
  MediaEntityType,
  MediaKind,
  MistakeStatus,
  OfflineSyncEventType,
  QuestionReportCategory,
  QuestionReportStatus,
  SyncEventStatus,
  V3ImportFormat,
} from "./v3";

/**
 * Typed Supabase PostgreSQL schema matching all 36 canonical tables in migrations `0001`–`0015`.
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
          confidence_enabled: boolean;
          mode_preferences: Json;
          progress_generation: number;
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
          confidence_enabled?: boolean;
          mode_preferences?: Json;
          progress_generation?: number;
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
          confidence_enabled?: boolean;
          mode_preferences?: Json;
          progress_generation?: number;
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
          content_version: number;
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
          content_version?: number;
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
          content_version?: number;
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
          prompt_rich: Json | null;
          prompt_image_url: string | null;
          back_text: string | null;
          back_rich: Json | null;
          back_image_url: string | null;
          explanation: string | null;
          explanation_rich: Json | null;
          hint: string | null;
          hint_rich: Json | null;
          audio_media_id: string | null;
          audio_url: string | null;
          audio_transcript: string | null;
          passage_id: string | null;
          diagram_id: string | null;
          type_payload: Json | null;
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
          prompt?: string;
          prompt_rich?: Json | null;
          prompt_image_url?: string | null;
          back_text?: string | null;
          back_rich?: Json | null;
          back_image_url?: string | null;
          explanation?: string | null;
          explanation_rich?: Json | null;
          hint?: string | null;
          hint_rich?: Json | null;
          audio_media_id?: string | null;
          audio_url?: string | null;
          audio_transcript?: string | null;
          passage_id?: string | null;
          diagram_id?: string | null;
          type_payload?: Json | null;
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
          prompt_rich?: Json | null;
          prompt_image_url?: string | null;
          back_text?: string | null;
          back_rich?: Json | null;
          back_image_url?: string | null;
          explanation?: string | null;
          explanation_rich?: Json | null;
          hint?: string | null;
          hint_rich?: Json | null;
          audio_media_id?: string | null;
          audio_url?: string | null;
          audio_transcript?: string | null;
          passage_id?: string | null;
          diagram_id?: string | null;
          type_payload?: Json | null;
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
          content_rich: Json | null;
          image_url: string | null;
          media_id: string | null;
          image_alt: string | null;
          is_correct: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          study_set_id: string;
          position?: number;
          label: string;
          content?: string;
          content_rich?: Json | null;
          image_url?: string | null;
          media_id?: string | null;
          image_alt?: string | null;
          is_correct?: boolean;
          created_at?: string;
        };
        Update: {
          position?: number;
          label?: string;
          content?: string;
          content_rich?: Json | null;
          image_url?: string | null;
          media_id?: string | null;
          image_alt?: string | null;
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
          consecutive_wrong: number;
          ease_factor: number;
          interval_days: number;
          repetitions: number;
          last_reviewed_at: string | null;
          last_wrong_at: string | null;
          next_review_at: string | null;
          last_confidence: ConfidenceLevel | null;
          low_confidence_count: number;
          high_conf_wrong_count: number;
          guess_correct_count: number;
          independent_recall_count: number;
          hint_used_count: number;
          mistake_status: MistakeStatus;
          progress_generation: number;
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
          consecutive_wrong?: number;
          ease_factor?: number;
          interval_days?: number;
          repetitions?: number;
          last_reviewed_at?: string | null;
          last_wrong_at?: string | null;
          next_review_at?: string | null;
          last_confidence?: ConfidenceLevel | null;
          low_confidence_count?: number;
          high_conf_wrong_count?: number;
          guess_correct_count?: number;
          independent_recall_count?: number;
          hint_used_count?: number;
          mistake_status?: MistakeStatus;
          progress_generation?: number;
          updated_at?: string;
        };
        Update: {
          mastery_level?: MasteryLevel;
          correct_count?: number;
          wrong_count?: number;
          consecutive_correct?: number;
          consecutive_wrong?: number;
          ease_factor?: number;
          interval_days?: number;
          repetitions?: number;
          last_reviewed_at?: string | null;
          last_wrong_at?: string | null;
          next_review_at?: string | null;
          last_confidence?: ConfidenceLevel | null;
          low_confidence_count?: number;
          high_conf_wrong_count?: number;
          guess_correct_count?: number;
          independent_recall_count?: number;
          hint_used_count?: number;
          mistake_status?: MistakeStatus;
          progress_generation?: number;
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
          structured_response: Json | null;
          confidence: ConfidenceLevel | null;
          hint_used: boolean;
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
          structured_response?: Json | null;
          confidence?: ConfidenceLevel | null;
          hint_used?: boolean;
          is_correct: boolean;
          self_rating?: SelfRating | null;
          response_time_ms?: number | null;
          answered_at?: string;
        };
        Update: {
          selected_option_ids?: string[];
          typed_answer?: string | null;
          structured_response?: Json | null;
          confidence?: ConfidenceLevel | null;
          hint_used?: boolean;
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
          prompt_rich_snapshot: Json | null;
          prompt_image_url_snapshot: string | null;
          audio_media_id_snapshot: string | null;
          audio_url_snapshot: string | null;
          passage_snapshot: Json | null;
          diagram_snapshot: Json | null;
          type_payload_snapshot: Json | null;
          media_snapshot: Json;
          explanation_snapshot: string | null;
          explanation_rich_snapshot: Json | null;
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
          prompt_snapshot?: string;
          prompt_rich_snapshot?: Json | null;
          prompt_image_url_snapshot?: string | null;
          audio_media_id_snapshot?: string | null;
          audio_url_snapshot?: string | null;
          passage_snapshot?: Json | null;
          diagram_snapshot?: Json | null;
          type_payload_snapshot?: Json | null;
          media_snapshot?: Json;
          explanation_snapshot?: string | null;
          explanation_rich_snapshot?: Json | null;
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
          structured_response: Json | null;
          confidence: ConfidenceLevel | null;
          hint_used: boolean;
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
          structured_response?: Json | null;
          confidence?: ConfidenceLevel | null;
          hint_used?: boolean;
          is_flagged?: boolean;
          is_correct?: boolean | null;
          client_seq?: number;
          updated_at?: string;
        };
        Update: {
          selected_option_ids?: string[];
          typed_answer?: string | null;
          structured_response?: Json | null;
          confidence?: ConfidenceLevel | null;
          hint_used?: boolean;
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
          source_format: V3ImportFormat;
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
          source_format: V3ImportFormat;
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
      media_assets: {
        Row: {
          id: string;
          owner_id: string;
          study_set_id: string | null;
          kind: MediaKind;
          storage_bucket: string;
          storage_path: string;
          mime_type: string;
          file_name: string;
          size_bytes: number;
          sha256_hash: string | null;
          width: number | null;
          height: number | null;
          duration_ms: number | null;
          alt_text: string | null;
          caption: string | null;
          is_orphaned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          study_set_id?: string | null;
          kind: MediaKind;
          storage_bucket?: string;
          storage_path: string;
          mime_type: string;
          file_name: string;
          size_bytes: number;
          sha256_hash?: string | null;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          alt_text?: string | null;
          caption?: string | null;
          is_orphaned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          alt_text?: string | null;
          caption?: string | null;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          is_orphaned?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "media_assets_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_assets_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      content_media_relations: {
        Row: {
          id: string;
          media_id: string;
          entity_type: MediaEntityType;
          entity_id: string;
          role: MediaAttachmentRole;
          sort_order: number;
          alt_text: string | null;
          caption: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          media_id: string;
          entity_type: MediaEntityType;
          entity_id: string;
          role: MediaAttachmentRole;
          sort_order?: number;
          alt_text?: string | null;
          caption?: string | null;
          created_at?: string;
        };
        Update: {
          sort_order?: number;
          alt_text?: string | null;
          caption?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_media_relations_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      shared_passages: {
        Row: {
          id: string;
          study_set_id: string;
          owner_id: string;
          title: string;
          content_text: string;
          content_rich: Json | null;
          audio_media_id: string | null;
          transcript: string | null;
          source_reference: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          owner_id: string;
          title: string;
          content_text: string;
          content_rich?: Json | null;
          audio_media_id?: string | null;
          transcript?: string | null;
          source_reference?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          content_text?: string;
          content_rich?: Json | null;
          audio_media_id?: string | null;
          transcript?: string | null;
          source_reference?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shared_passages_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shared_passages_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shared_passages_audio_media_id_fkey";
            columns: ["audio_media_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      diagram_sets: {
        Row: {
          id: string;
          study_set_id: string;
          owner_id: string;
          title: string;
          description: string | null;
          base_media_id: string | null;
          base_image_url: string;
          image_width: number | null;
          image_height: number | null;
          content_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          owner_id: string;
          title: string;
          description?: string | null;
          base_media_id?: string | null;
          base_image_url: string;
          image_width?: number | null;
          image_height?: number | null;
          content_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          description?: string | null;
          base_media_id?: string | null;
          base_image_url?: string;
          image_width?: number | null;
          image_height?: number | null;
          content_version?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "diagram_sets_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "diagram_sets_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "diagram_sets_base_media_id_fkey";
            columns: ["base_media_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      diagram_hotspots: {
        Row: {
          id: string;
          diagram_id: string;
          study_set_id: string;
          label: string;
          accepted_alternatives: string[];
          description: string | null;
          hint: string | null;
          shape: HotspotShape;
          geometry: Json;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          diagram_id: string;
          study_set_id: string;
          label: string;
          accepted_alternatives?: string[];
          description?: string | null;
          hint?: string | null;
          shape: HotspotShape;
          geometry: Json;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          accepted_alternatives?: string[];
          description?: string | null;
          hint?: string | null;
          shape?: HotspotShape;
          geometry?: Json;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "diagram_hotspots_diagram_id_fkey";
            columns: ["diagram_id"];
            isOneToOne: false;
            referencedRelation: "diagram_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "diagram_hotspots_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      user_question_notes: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          content_text: string;
          content_rich: Json | null;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          content_text: string;
          content_rich?: Json | null;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          content_text?: string;
          content_rich?: Json | null;
          version?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_question_notes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_question_notes_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_question_notes_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      question_reports: {
        Row: {
          id: string;
          study_set_id: string;
          question_id: string;
          reporter_id: string;
          category: QuestionReportCategory;
          description: string;
          status: QuestionReportStatus;
          resolution_note: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          study_set_id: string;
          question_id: string;
          reporter_id: string;
          category: QuestionReportCategory;
          description: string;
          status?: QuestionReportStatus;
          resolution_note?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: QuestionReportStatus;
          resolution_note?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_reports_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_reports_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_session_checkpoints: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string | null;
          mode: StudyMode;
          session_key: string;
          state_json: Json;
          progress_percent: number;
          current_index: number;
          total_items: number;
          device_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id?: string | null;
          mode: StudyMode;
          session_key: string;
          state_json?: Json;
          progress_percent?: number;
          current_index?: number;
          total_items?: number;
          device_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          state_json?: Json;
          progress_percent?: number;
          current_index?: number;
          total_items?: number;
          device_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_session_checkpoints_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_session_checkpoints_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_confidence_events: {
        Row: {
          id: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          mode: StudyMode | "exam";
          confidence: ConfidenceLevel;
          is_correct: boolean;
          hint_used: boolean;
          response_time_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_set_id: string;
          question_id: string;
          mode: StudyMode | "exam";
          confidence: ConfidenceLevel;
          is_correct: boolean;
          hint_used?: boolean;
          response_time_ms?: number | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "learning_confidence_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_confidence_events_study_set_id_fkey";
            columns: ["study_set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_confidence_events_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_sync_events: {
        Row: {
          event_id: string;
          user_id: string;
          event_type: OfflineSyncEventType;
          study_set_id: string | null;
          question_id: string | null;
          client_timestamp: string;
          progress_generation: number;
          status: SyncEventStatus;
          payload: Json;
          result_detail: Json | null;
          processed_at: string;
        };
        Insert: {
          event_id: string;
          user_id: string;
          event_type: OfflineSyncEventType;
          study_set_id?: string | null;
          question_id?: string | null;
          client_timestamp: string;
          progress_generation?: number;
          status?: SyncEventStatus;
          payload?: Json;
          result_detail?: Json | null;
          processed_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "learning_sync_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      is_folder_owner: {
        Args: { p_folder_id: string; p_user_id: string };
        Returns: boolean;
      };
      can_read_tag: {
        Args: { p_tag_id: string; p_user_id: string };
        Returns: boolean;
      };
      reset_learning_progress: {
        Args: {
          p_scope: string;
          p_study_set_id?: string | null;
          p_subject?: string | null;
          p_chapter?: string | null;
          p_question_ids?: string[] | null;
          p_mode?: string | null;
          p_clear_mistakes?: boolean;
          p_clear_starred?: boolean;
          p_clear_checkpoints?: boolean;
        };
        Returns: Json;
      };
      global_library_search: {
        Args: {
          p_query: string;
          p_types?: string[] | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      sync_offline_learning_events: {
        Args: { p_events: Json };
        Returns: Json;
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
      import_format: V3ImportFormat;
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
