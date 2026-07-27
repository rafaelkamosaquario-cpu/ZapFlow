// Gerado por: npx supabase gen types typescript --project-id kqquswdrtcqicyfcvvuv --schema public
// (aplicado via ferramenta MCP generate_typescript_types, equivalente funcional do comando acima
// — a conexao direta ao Postgres do projeto remoto nao e alcancavel a partir deste sandbox).
// NAO EDITAR A MAO. Regerar apos qualquer nova migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_memories: {
        Row: {
          company_id: string
          confidence: number | null
          confirmed_by_user: boolean
          conversation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          key: string
          memory_type: Database["public"]["Enums"]["ai_memory_type"]
          source_message_id: string | null
          source_type: Database["public"]["Enums"]["ai_memory_source_type"]
          status: Database["public"]["Enums"]["ai_memory_status"]
          summary: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          valid_from: string
          valid_until: string | null
          value_json: Json
          vehicle_id: string | null
        }
        Insert: {
          company_id: string
          confidence?: number | null
          confirmed_by_user?: boolean
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          memory_type: Database["public"]["Enums"]["ai_memory_type"]
          source_message_id?: string | null
          source_type: Database["public"]["Enums"]["ai_memory_source_type"]
          status?: Database["public"]["Enums"]["ai_memory_status"]
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          valid_from?: string
          valid_until?: string | null
          value_json?: Json
          vehicle_id?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number | null
          confirmed_by_user?: boolean
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          memory_type?: Database["public"]["Enums"]["ai_memory_type"]
          source_message_id?: string | null
          source_type?: Database["public"]["Enums"]["ai_memory_source_type"]
          status?: Database["public"]["Enums"]["ai_memory_status"]
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          valid_from?: string
          valid_until?: string | null
          value_json?: Json
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas: {
        Row: {
          acao_recomendada: string | null
          checklist_id: number | null
          criado_em: string | null
          descricao: string | null
          id: number
          motorista_id: number | null
          nivel: string
          resolvido: boolean | null
          whatsapp: string
        }
        Insert: {
          acao_recomendada?: string | null
          checklist_id?: number | null
          criado_em?: string | null
          descricao?: string | null
          id?: number
          motorista_id?: number | null
          nivel: string
          resolvido?: boolean | null
          whatsapp: string
        }
        Update: {
          acao_recomendada?: string | null
          checklist_id?: number | null
          criado_em?: string | null
          descricao?: string | null
          id?: number
          motorista_id?: number | null
          nivel?: string
          resolvido?: boolean | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_runs: {
        Row: {
          analysis_type: string
          company_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          error_code: string | null
          error_message_safe: string | null
          id: string
          input_snapshot: Json
          result_data: Json | null
          result_summary: string | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          user_id: string
          user_request: string | null
          vehicle_id: string | null
        }
        Insert: {
          analysis_type: string
          company_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          input_snapshot?: Json
          result_data?: Json | null
          result_summary?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          user_id: string
          user_request?: string | null
          vehicle_id?: string | null
        }
        Update: {
          analysis_type?: string
          company_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          input_snapshot?: Json
          result_data?: Json | null
          result_summary?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          user_id?: string
          user_request?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_runs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_action_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["calendar_action_type"]
          company_id: string
          conversation_id: string | null
          created_at: string
          error_code: string | null
          event_end: string | null
          event_start: string | null
          event_title: string | null
          external_event_id: string | null
          google_integration_id: string
          id: string
          status: Database["public"]["Enums"]["calendar_action_status"]
          timezone: string | null
          user_id: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["calendar_action_type"]
          company_id: string
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          event_end?: string | null
          event_start?: string | null
          event_title?: string | null
          external_event_id?: string | null
          google_integration_id: string
          id?: string
          status?: Database["public"]["Enums"]["calendar_action_status"]
          timezone?: string | null
          user_id: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["calendar_action_type"]
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          event_end?: string | null
          event_start?: string | null
          event_title?: string | null
          external_event_id?: string | null
          google_integration_id?: string
          id?: string
          status?: Database["public"]["Enums"]["calendar_action_status"]
          timezone?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_action_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_action_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_action_logs_google_integration_id_fkey"
            columns: ["google_integration_id"]
            isOneToOne: false
            referencedRelation: "google_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_logs: {
        Row: {
          criado_em: string | null
          data: string
          horario_resposta: string | null
          id: number
          motorista_id: number
          respondido: boolean | null
          resposta: string | null
          tentativas: number | null
        }
        Insert: {
          criado_em?: string | null
          data: string
          horario_resposta?: string | null
          id?: number
          motorista_id: number
          respondido?: boolean | null
          resposta?: string | null
          tentativas?: number | null
        }
        Update: {
          criado_em?: string | null
          data?: string
          horario_resposta?: string | null
          id?: number
          motorista_id?: number
          respondido?: boolean | null
          resposta?: string | null
          tentativas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_logs_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          acao_recomendada: string | null
          classificacao: string | null
          criado_em: string | null
          id: number
          mensagem_original: string
          motorista_id: number | null
          resposta_texto: string | null
          resumo: string | null
          whatsapp: string
        }
        Insert: {
          acao_recomendada?: string | null
          classificacao?: string | null
          criado_em?: string | null
          id?: number
          mensagem_original: string
          motorista_id?: number | null
          resposta_texto?: string | null
          resumo?: string | null
          whatsapp: string
        }
        Update: {
          acao_recomendada?: string | null
          classificacao?: string | null
          criado_em?: string | null
          id?: number
          mensagem_original?: string
          motorista_id?: number | null
          resposta_texto?: string | null
          resumo?: string | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          city: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          country_code: string
          created_at: string
          created_by: string | null
          document_number: string | null
          document_type:
            | Database["public"]["Enums"]["company_document_type"]
            | null
          id: string
          name: string
          state: string | null
          timezone: string
          trade_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          city?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          country_code?: string
          created_at?: string
          created_by?: string | null
          document_number?: string | null
          document_type?:
            | Database["public"]["Enums"]["company_document_type"]
            | null
          id?: string
          name: string
          state?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          city?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          country_code?: string
          created_at?: string
          created_by?: string | null
          document_number?: string | null
          document_type?:
            | Database["public"]["Enums"]["company_document_type"]
            | null
          id?: string
          name?: string
          state?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          role: Database["public"]["Enums"]["company_member_role"]
          status: Database["public"]["Enums"]["company_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          role?: Database["public"]["Enums"]["company_member_role"]
          status?: Database["public"]["Enums"]["company_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          role?: Database["public"]["Enums"]["company_member_role"]
          status?: Database["public"]["Enums"]["company_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_preferences: {
        Row: {
          allow_analysis_history: boolean
          allow_automatic_memory: boolean
          allow_tool_history: boolean
          ask_before_saving_memory: boolean
          company_id: string
          created_at: string
          default_average_speed_kmh: number | null
          default_currency: string
          default_fuel_price: number | null
          default_fuel_type: Database["public"]["Enums"]["fuel_type"] | null
          default_target_margin_percent: number | null
          default_vehicle_id: string | null
          distance_unit: string
          id: string
          preferred_response_style: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_analysis_history?: boolean
          allow_automatic_memory?: boolean
          allow_tool_history?: boolean
          ask_before_saving_memory?: boolean
          company_id: string
          created_at?: string
          default_average_speed_kmh?: number | null
          default_currency?: string
          default_fuel_price?: number | null
          default_fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          default_target_margin_percent?: number | null
          default_vehicle_id?: string | null
          distance_unit?: string
          id?: string
          preferred_response_style?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_analysis_history?: boolean
          allow_automatic_memory?: boolean
          allow_tool_history?: boolean
          ask_before_saving_memory?: boolean
          company_id?: string
          created_at?: string
          default_average_speed_kmh?: number | null
          default_currency?: string
          default_fuel_price?: number | null
          default_fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          default_target_margin_percent?: number | null
          default_vehicle_id?: string | null
          distance_unit?: string
          id?: string
          preferred_response_style?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_preferences_default_vehicle_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          chave: string
          id: number
          valor: string | null
        }
        Insert: {
          chave: string
          id?: number
          valor?: string | null
        }
        Update: {
          chave?: string
          id?: number
          valor?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          channel_id: string | null
          closed_at: string | null
          company_id: string
          created_at: string
          external_conversation_id: string | null
          id: string
          last_message_at: string
          metadata: Json
          started_at: string
          status: Database["public"]["Enums"]["conversation_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id?: string | null
          closed_at?: string | null
          company_id: string
          created_at?: string
          external_conversation_id?: string | null
          id?: string
          last_message_at?: string
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string | null
          closed_at?: string | null
          company_id?: string
          created_at?: string
          external_conversation_id?: string | null
          id?: string
          last_message_at?: string
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "user_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos: {
        Row: {
          criado_em: string | null
          id: number
          referencia: string
          renovado: boolean | null
          tipo: string
          vencimento: string
        }
        Insert: {
          criado_em?: string | null
          id?: number
          referencia: string
          renovado?: boolean | null
          tipo: string
          vencimento: string
        }
        Update: {
          criado_em?: string | null
          id?: number
          referencia?: string
          renovado?: boolean | null
          tipo?: string
          vencimento?: string
        }
        Relationships: []
      }
      google_integrations: {
        Row: {
          calendar_enabled: boolean
          company_id: string | null
          connection_status: Database["public"]["Enums"]["google_connection_status"]
          created_at: string
          default_calendar_id: string | null
          google_account_email: string
          google_subject_id: string | null
          granted_scopes: string[]
          id: string
          last_synced_at: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_enabled?: boolean
          company_id?: string | null
          connection_status?: Database["public"]["Enums"]["google_connection_status"]
          created_at?: string
          default_calendar_id?: string | null
          google_account_email: string
          google_subject_id?: string | null
          granted_scopes?: string[]
          id?: string
          last_synced_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_enabled?: boolean
          company_id?: string | null
          connection_status?: Database["public"]["Enums"]["google_connection_status"]
          created_at?: string
          default_calendar_id?: string | null
          google_account_email?: string
          google_subject_id?: string | null
          granted_scopes?: string[]
          id?: string
          last_synced_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencoes: {
        Row: {
          agendada: boolean | null
          concluida: boolean | null
          criado_em: string | null
          id: number
          tipo: string
          veiculo_id: number
          vencimento: string
        }
        Insert: {
          agendada?: boolean | null
          concluida?: boolean | null
          criado_em?: string | null
          id?: number
          tipo: string
          veiculo_id: number
          vencimento: string
        }
        Update: {
          agendada?: boolean | null
          concluida?: boolean | null
          criado_em?: string | null
          id?: number
          tipo?: string
          veiculo_id?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencoes_veiculo_id_fkey"
            columns: ["veiculo_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          company_id: string
          content: string | null
          content_type: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id: string | null
          id: string
          metadata: Json
          role: Database["public"]["Enums"]["message_role"]
          tool_call_id: string | null
          user_id: string | null
        }
        Insert: {
          company_id: string
          content?: string | null
          content_type?: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          metadata?: Json
          role: Database["public"]["Enums"]["message_role"]
          tool_call_id?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          content?: string | null
          content_type?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          metadata?: Json
          role?: Database["public"]["Enums"]["message_role"]
          tool_call_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tool_call_id_fkey"
            columns: ["tool_call_id"]
            isOneToOne: false
            referencedRelation: "tool_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      motoristas: {
        Row: {
          ativo: boolean | null
          criado_em: string | null
          id: number
          nome: string
          veiculo_atual_id: number | null
          veiculo_placa: string | null
          whatsapp: string
        }
        Insert: {
          ativo?: boolean | null
          criado_em?: string | null
          id?: number
          nome: string
          veiculo_atual_id?: number | null
          veiculo_placa?: string | null
          whatsapp: string
        }
        Update: {
          ativo?: boolean | null
          criado_em?: string | null
          id?: number
          nome?: string
          veiculo_atual_id?: number | null
          veiculo_placa?: string | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "motoristas_veiculo_atual_id_fkey"
            columns: ["veiculo_atual_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          onboarding_completed: boolean
          phone_e164: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          onboarding_completed?: boolean
          phone_e164?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          onboarding_completed?: boolean
          phone_e164?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_routes: {
        Row: {
          active: boolean
          average_consumption_km_l: number | null
          average_speed_kmh: number | null
          company_id: string
          created_at: string
          created_by: string | null
          data_source: Database["public"]["Enums"]["route_data_source"]
          destination_city: string | null
          destination_name: string | null
          destination_state: string | null
          distance_km: number | null
          estimated_duration_minutes: number | null
          estimated_toll_cost: number | null
          id: string
          is_favorite: boolean
          metadata: Json
          name: string | null
          origin_city: string | null
          origin_name: string | null
          origin_state: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          active?: boolean
          average_consumption_km_l?: number | null
          average_speed_kmh?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          data_source?: Database["public"]["Enums"]["route_data_source"]
          destination_city?: string | null
          destination_name?: string | null
          destination_state?: string | null
          distance_km?: number | null
          estimated_duration_minutes?: number | null
          estimated_toll_cost?: number | null
          id?: string
          is_favorite?: boolean
          metadata?: Json
          name?: string | null
          origin_city?: string | null
          origin_name?: string | null
          origin_state?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          active?: boolean
          average_consumption_km_l?: number | null
          average_speed_kmh?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          data_source?: Database["public"]["Enums"]["route_data_source"]
          destination_city?: string | null
          destination_name?: string | null
          destination_state?: string | null
          distance_km?: number | null
          estimated_duration_minutes?: number | null
          estimated_toll_cost?: number | null
          id?: string
          is_favorite?: boolean
          metadata?: Json
          name?: string | null
          origin_city?: string | null
          origin_name?: string | null
          origin_state?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_executions: {
        Row: {
          analysis_run_id: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message_safe: string | null
          id: string
          input_data: Json
          message_id: string | null
          output_data: Json | null
          status: Database["public"]["Enums"]["run_status"]
          tool_name: Database["public"]["Enums"]["frota_ia_tool_name"]
          tool_version: string | null
          user_id: string
        }
        Insert: {
          analysis_run_id?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          input_data?: Json
          message_id?: string | null
          output_data?: Json | null
          status?: Database["public"]["Enums"]["run_status"]
          tool_name: Database["public"]["Enums"]["frota_ia_tool_name"]
          tool_version?: string | null
          user_id: string
        }
        Update: {
          analysis_run_id?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          input_data?: Json
          message_id?: string | null
          output_data?: Json | null
          status?: Database["public"]["Enums"]["run_status"]
          tool_name?: Database["public"]["Enums"]["frota_ia_tool_name"]
          tool_version?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_executions_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_executions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_executions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_executions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_channels: {
        Row: {
          active: boolean
          channel_type: Database["public"]["Enums"]["channel_type"]
          company_id: string | null
          created_at: string
          display_name: string | null
          external_user_id: string
          id: string
          metadata: Json
          phone_e164: string | null
          provider: Database["public"]["Enums"]["channel_provider"]
          updated_at: string
          user_id: string
          verified: boolean
        }
        Insert: {
          active?: boolean
          channel_type?: Database["public"]["Enums"]["channel_type"]
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          external_user_id: string
          id?: string
          metadata?: Json
          phone_e164?: string | null
          provider?: Database["public"]["Enums"]["channel_provider"]
          updated_at?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          active?: boolean
          channel_type?: Database["public"]["Enums"]["channel_type"]
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          external_user_id?: string
          id?: string
          metadata?: Json
          phone_e164?: string | null
          provider?: Database["public"]["Enums"]["channel_provider"]
          updated_at?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_channels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_cost_profiles: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          depreciation_cost_per_km: number | null
          driver_cost_per_day: number | null
          effective_from: string
          effective_to: string | null
          fixed_cost_per_day: number | null
          fixed_cost_per_month: number | null
          fuel_price_per_liter: number | null
          id: string
          maintenance_cost_per_km: number | null
          metadata: Json
          other_cost_per_km: number | null
          target_margin_percent: number | null
          tire_cost_per_km: number | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          depreciation_cost_per_km?: number | null
          driver_cost_per_day?: number | null
          effective_from?: string
          effective_to?: string | null
          fixed_cost_per_day?: number | null
          fixed_cost_per_month?: number | null
          fuel_price_per_liter?: number | null
          id?: string
          maintenance_cost_per_km?: number | null
          metadata?: Json
          other_cost_per_km?: number | null
          target_margin_percent?: number | null
          tire_cost_per_km?: number | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          depreciation_cost_per_km?: number | null
          driver_cost_per_day?: number | null
          effective_from?: string
          effective_to?: string | null
          fixed_cost_per_day?: number | null
          fixed_cost_per_month?: number | null
          fuel_price_per_liter?: number | null
          id?: string
          maintenance_cost_per_km?: number | null
          metadata?: Json
          other_cost_per_km?: number | null
          target_margin_percent?: number | null
          tire_cost_per_km?: number | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_cost_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_cost_profiles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_tire_profiles: {
        Row: {
          acquisition_cost: number | null
          active: boolean
          brand: string | null
          company_id: string
          created_at: string
          created_by: string | null
          expected_life_km: number | null
          expected_recap_life_km: number | null
          id: string
          model: string | null
          notes: string | null
          number_of_recaps: number | null
          recap_cost: number | null
          size: string | null
          tire_category: Database["public"]["Enums"]["tire_category"]
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          acquisition_cost?: number | null
          active?: boolean
          brand?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          expected_life_km?: number | null
          expected_recap_life_km?: number | null
          id?: string
          model?: string | null
          notes?: string | null
          number_of_recaps?: number | null
          recap_cost?: number | null
          size?: string | null
          tire_category?: Database["public"]["Enums"]["tire_category"]
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          acquisition_cost?: number | null
          active?: boolean
          brand?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          expected_life_km?: number | null
          expected_recap_life_km?: number | null
          id?: string
          model?: string | null
          notes?: string | null
          number_of_recaps?: number | null
          recap_cost?: number | null
          size?: string | null
          tire_category?: Database["public"]["Enums"]["tire_category"]
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_tire_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_tire_profiles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean
          average_consumption_km_l: number | null
          average_speed_kmh: number | null
          brand: string | null
          company_id: string
          created_at: string
          created_by: string | null
          current_odometer_km: number | null
          fuel_type: Database["public"]["Enums"]["fuel_type"] | null
          id: string
          is_default: boolean
          load_capacity_kg: number | null
          model: string | null
          model_year: number | null
          name: string | null
          notes: string | null
          plate: string | null
          updated_at: string
          updated_by: string | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Insert: {
          active?: boolean
          average_consumption_km_l?: number | null
          average_speed_kmh?: number | null
          brand?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          current_odometer_km?: number | null
          fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          id?: string
          is_default?: boolean
          load_capacity_kg?: number | null
          model?: string | null
          model_year?: number | null
          name?: string | null
          notes?: string | null
          plate?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Update: {
          active?: boolean
          average_consumption_km_l?: number | null
          average_speed_kmh?: number | null
          brand?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_odometer_km?: number | null
          fuel_type?: Database["public"]["Enums"]["fuel_type"] | null
          id?: string
          is_default?: boolean
          load_capacity_kg?: number | null
          model?: string | null
          model_year?: number | null
          name?: string | null
          notes?: string | null
          plate?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      veiculos: {
        Row: {
          ano: number | null
          ativo: boolean | null
          criado_em: string | null
          id: number
          modelo: string | null
          placa: string
        }
        Insert: {
          ano?: number | null
          ativo?: boolean | null
          criado_em?: string | null
          id?: number
          modelo?: string | null
          placa: string
        }
        Update: {
          ano?: number | null
          ativo?: boolean | null
          criado_em?: string | null
          id?: number
          modelo?: string | null
          placa?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      default_company_id: { Args: never; Returns: string }
      has_company_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["company_member_role"][]
          target_company_id: string
        }
        Returns: boolean
      }
      is_company_member: {
        Args: { target_company_id: string }
        Returns: boolean
      }
    }
    Enums: {
      ai_memory_source_type:
        | "user_explicit"
        | "conversation"
        | "calculation"
        | "system"
      ai_memory_status: "active" | "superseded" | "rejected" | "deleted"
      ai_memory_type:
        | "profile"
        | "vehicle"
        | "cost"
        | "tire"
        | "route"
        | "preference"
        | "operational"
        | "other"
      calendar_action_status: "pending" | "success" | "failed"
      calendar_action_type: "create" | "read" | "update" | "delete"
      channel_provider: "z_api" | "internal" | "outro"
      channel_type: "whatsapp" | "web" | "outro"
      company_document_type: "cpf" | "cnpj" | "outro"
      company_member_role: "owner" | "admin" | "operator" | "viewer"
      company_member_status: "active" | "invited" | "removed"
      company_type: "autonomo" | "transportadora" | "embarcador" | "outro"
      conversation_status: "open" | "closed" | "archived"
      frota_ia_tool_name:
        | "analisar_frete"
        | "calcular_combustivel"
        | "calcular_cpk"
        | "comparar_pneus"
        | "calcular_custo_viagem"
        | "calcular_margem"
        | "calcular_valor_minimo_frete"
        | "calcular_receita_km"
        | "calcular_custo_dia"
        | "calcular_custo_veiculo_parado"
        | "calcular_jornada"
      fuel_type:
        | "diesel_s10"
        | "diesel_s500"
        | "gasolina"
        | "etanol"
        | "eletrico"
        | "outro"
      google_connection_status:
        | "pending"
        | "connected"
        | "expired"
        | "revoked"
        | "error"
      message_direction: "inbound" | "outbound" | "internal"
      message_role: "user" | "assistant" | "system" | "tool"
      route_data_source: "manual" | "google_routes" | "outro"
      run_status: "started" | "completed" | "failed" | "cancelled"
      tire_category:
        | "novo_nacional"
        | "novo_importado"
        | "recapado"
        | "misto"
        | "outro"
      vehicle_type:
        | "utilitario"
        | "tres_quartos"
        | "toco"
        | "truck"
        | "cavalo_mecanico"
        | "carreta"
        | "bitrem"
        | "rodotrem"
        | "onibus"
        | "outro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_memory_source_type: [
        "user_explicit",
        "conversation",
        "calculation",
        "system",
      ],
      ai_memory_status: ["active", "superseded", "rejected", "deleted"],
      ai_memory_type: [
        "profile",
        "vehicle",
        "cost",
        "tire",
        "route",
        "preference",
        "operational",
        "other",
      ],
      calendar_action_status: ["pending", "success", "failed"],
      calendar_action_type: ["create", "read", "update", "delete"],
      channel_provider: ["z_api", "internal", "outro"],
      channel_type: ["whatsapp", "web", "outro"],
      company_document_type: ["cpf", "cnpj", "outro"],
      company_member_role: ["owner", "admin", "operator", "viewer"],
      company_member_status: ["active", "invited", "removed"],
      company_type: ["autonomo", "transportadora", "embarcador", "outro"],
      conversation_status: ["open", "closed", "archived"],
      frota_ia_tool_name: [
        "analisar_frete",
        "calcular_combustivel",
        "calcular_cpk",
        "comparar_pneus",
        "calcular_custo_viagem",
        "calcular_margem",
        "calcular_valor_minimo_frete",
        "calcular_receita_km",
        "calcular_custo_dia",
        "calcular_custo_veiculo_parado",
        "calcular_jornada",
      ],
      fuel_type: [
        "diesel_s10",
        "diesel_s500",
        "gasolina",
        "etanol",
        "eletrico",
        "outro",
      ],
      google_connection_status: [
        "pending",
        "connected",
        "expired",
        "revoked",
        "error",
      ],
      message_direction: ["inbound", "outbound", "internal"],
      message_role: ["user", "assistant", "system", "tool"],
      route_data_source: ["manual", "google_routes", "outro"],
      run_status: ["started", "completed", "failed", "cancelled"],
      tire_category: [
        "novo_nacional",
        "novo_importado",
        "recapado",
        "misto",
        "outro",
      ],
      vehicle_type: [
        "utilitario",
        "tres_quartos",
        "toco",
        "truck",
        "cavalo_mecanico",
        "carreta",
        "bitrem",
        "rodotrem",
        "onibus",
        "outro",
      ],
    },
  },
} as const

