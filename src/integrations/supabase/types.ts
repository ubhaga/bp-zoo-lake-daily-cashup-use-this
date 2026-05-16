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
      bank_line_allocations: {
        Row: {
          bank_line_id: string
          created_at: string
          id: string
          month: string
          recon_type: string
          target_name: string
        }
        Insert: {
          bank_line_id: string
          created_at?: string
          id?: string
          month: string
          recon_type?: string
          target_name?: string
        }
        Update: {
          bank_line_id?: string
          created_at?: string
          id?: string
          month?: string
          recon_type?: string
          target_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_line_allocations_bank_line_id_fkey"
            columns: ["bank_line_id"]
            isOneToOne: true
            referencedRelation: "bank_statement_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          max_amount: number | null
          min_amount: number | null
          priority: number
          recon_type: string
          reference: string
          target_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          recon_type: string
          reference?: string
          target_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          recon_type?: string
          reference?: string
          target_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      bank_statement_lines: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          matched_terminal: string
          month: string
          raw_line: string
          transaction_date: string
          upload_date: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          matched_terminal?: string
          month: string
          raw_line?: string
          transaction_date?: string
          upload_date?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          matched_terminal?: string
          month?: string
          raw_line?: string
          transaction_date?: string
          upload_date?: string
        }
        Relationships: []
      }
      bp_invoices: {
        Row: {
          amount_capital: number
          amount_total: number | null
          amount_vat: number
          cashup_date: string | null
          classified_by: string
          created_at: string
          description: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          invoice_type: string
          line_items: Json | null
          month: string | null
          pdf_filename: string | null
          pdf_url: string | null
          source_email: string | null
          supplier: string
          updated_at: string
        }
        Insert: {
          amount_capital?: number
          amount_total?: number | null
          amount_vat?: number
          cashup_date?: string | null
          classified_by?: string
          created_at?: string
          description?: string | null
          id?: string
          invoice_date: string
          invoice_number?: string | null
          invoice_type: string
          line_items?: Json | null
          month?: string | null
          pdf_filename?: string | null
          pdf_url?: string | null
          source_email?: string | null
          supplier?: string
          updated_at?: string
        }
        Update: {
          amount_capital?: number
          amount_total?: number | null
          amount_vat?: number
          cashup_date?: string | null
          classified_by?: string
          created_at?: string
          description?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          invoice_type?: string
          line_items?: Json | null
          month?: string | null
          pdf_filename?: string | null
          pdf_url?: string | null
          source_email?: string | null
          supplier?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_recon_manual_matches: {
        Row: {
          amount: number
          bank_line_id: string
          cashup_date: string
          created_at: string
          id: string
          month: string
          recon_kind: string
        }
        Insert: {
          amount?: number
          bank_line_id: string
          cashup_date: string
          created_at?: string
          id?: string
          month: string
          recon_kind?: string
        }
        Update: {
          amount?: number
          bank_line_id?: string
          cashup_date?: string
          created_at?: string
          id?: string
          month?: string
          recon_kind?: string
        }
        Relationships: []
      }
      commission_schedules: {
        Row: {
          commission_key: string
          created_at: string
          day_of_month: number | null
          id: string
          schedule_type: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          commission_key: string
          created_at?: string
          day_of_month?: number | null
          id?: string
          schedule_type: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          commission_key?: string
          created_at?: string
          day_of_month?: number | null
          id?: string
          schedule_type?: string
          updated_at?: string
          weekday?: number | null
        }
        Relationships: []
      }
      creditor_opening_balances: {
        Row: {
          amount: number
          created_at: string
          id: string
          month: string
          supplier: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          month: string
          supplier: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          month?: string
          supplier?: string
        }
        Relationships: []
      }
      daily_cashups: {
        Row: {
          cashier_name: string
          created_at: string
          date: string
          entered_by: string
          id: string
          locked: boolean
          month: string
          notes: string
          opt: Json
          opt_shift_number: number
          shop: Json
          shop_shift_number: number
          updated_at: string
        }
        Insert: {
          cashier_name?: string
          created_at?: string
          date: string
          entered_by?: string
          id?: string
          locked?: boolean
          month: string
          notes?: string
          opt?: Json
          opt_shift_number?: number
          shop?: Json
          shop_shift_number?: number
          updated_at?: string
        }
        Update: {
          cashier_name?: string
          created_at?: string
          date?: string
          entered_by?: string
          id?: string
          locked?: boolean
          month?: string
          notes?: string
          opt?: Json
          opt_shift_number?: number
          shop?: Json
          shop_shift_number?: number
          updated_at?: string
        }
        Relationships: []
      }
      day_end_uploads: {
        Row: {
          content: string
          created_at: string
          date: string
          filename: string
          id: string
          month: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          date: string
          filename?: string
          id?: string
          month: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          date?: string
          filename?: string
          id?: string
          month?: string
          updated_at?: string
        }
        Relationships: []
      }
      manager_daily_entries: {
        Row: {
          bank_charges: number
          bank_charges_rate: number
          banking: number
          blue_label_comm: number
          branch_day_end_total: number
          branch_day_end_vat: number
          cash_connect_opening_balance: number
          cash_deposited_cash_connect: number
          cash_deposited_easypay: number
          cash_reconc_notes: string
          cashup_id: string
          cc_bag_closure_cash_connect: number
          cc_bag_closure_coins: number
          cc_bag_closure_easypay: number
          coins_opening_balance: number
          created_at: string
          daily_coins: number
          date: string
          deep_frozen_cc: number
          easypay_comm: number
          easypay_opening_balance: number
          eft_invoices: Json
          entered_by: string
          explanations: string
          id: string
          invoice_notes: string
          locked: boolean
          lotto_comm: number
          lotto_net_sales_comm: number
          lotto_payout_comm: number
          payout_invoices: Json
          transfer_from_coins: number
          updated_at: string
        }
        Insert: {
          bank_charges?: number
          bank_charges_rate?: number
          banking?: number
          blue_label_comm?: number
          branch_day_end_total?: number
          branch_day_end_vat?: number
          cash_connect_opening_balance?: number
          cash_deposited_cash_connect?: number
          cash_deposited_easypay?: number
          cash_reconc_notes?: string
          cashup_id?: string
          cc_bag_closure_cash_connect?: number
          cc_bag_closure_coins?: number
          cc_bag_closure_easypay?: number
          coins_opening_balance?: number
          created_at?: string
          daily_coins?: number
          date: string
          deep_frozen_cc?: number
          easypay_comm?: number
          easypay_opening_balance?: number
          eft_invoices?: Json
          entered_by?: string
          explanations?: string
          id?: string
          invoice_notes?: string
          locked?: boolean
          lotto_comm?: number
          lotto_net_sales_comm?: number
          lotto_payout_comm?: number
          payout_invoices?: Json
          transfer_from_coins?: number
          updated_at?: string
        }
        Update: {
          bank_charges?: number
          bank_charges_rate?: number
          banking?: number
          blue_label_comm?: number
          branch_day_end_total?: number
          branch_day_end_vat?: number
          cash_connect_opening_balance?: number
          cash_deposited_cash_connect?: number
          cash_deposited_easypay?: number
          cash_reconc_notes?: string
          cashup_id?: string
          cc_bag_closure_cash_connect?: number
          cc_bag_closure_coins?: number
          cc_bag_closure_easypay?: number
          coins_opening_balance?: number
          created_at?: string
          daily_coins?: number
          date?: string
          deep_frozen_cc?: number
          easypay_comm?: number
          easypay_opening_balance?: number
          eft_invoices?: Json
          entered_by?: string
          explanations?: string
          id?: string
          invoice_notes?: string
          locked?: boolean
          lotto_comm?: number
          lotto_net_sales_comm?: number
          lotto_payout_comm?: number
          payout_invoices?: Json
          transfer_from_coins?: number
          updated_at?: string
        }
        Relationships: []
      }
      manual_pump_readings: {
        Row: {
          created_at: string
          date: string
          id: string
          month: string
          readings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          month: string
          readings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          month?: string
          readings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      master_data: {
        Row: {
          data: Json
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          data?: Json
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      monthly_branch_figures: {
        Row: {
          adj_c_store: number
          adj_fuel: number
          adj_gas: number
          adj_oil: number
          adj_vat: number
          adj_wsl_dsl: number
          airtime_bld_balance: number
          airtime_easypay_balance: number
          airtime_lotto_balance: number
          branch_net_sales: number
          branch_total_invoices_capital: number
          branch_total_invoices_vat: number
          branch_total_payouts: number
          branch_total_receipts: number
          created_at: string
          entered_by: string
          explanation_invoices: string
          explanation_net_sales: string
          explanation_payouts: string
          explanation_receipts: string
          explanation_vat: string
          id: string
          month: string
          notes: string
          sales_c_store: number
          sales_fuel: number
          sales_gas: number
          sales_oil: number
          sales_wsl_dsl: number
          updated_at: string
          vat_tax_amount: number
        }
        Insert: {
          adj_c_store?: number
          adj_fuel?: number
          adj_gas?: number
          adj_oil?: number
          adj_vat?: number
          adj_wsl_dsl?: number
          airtime_bld_balance?: number
          airtime_easypay_balance?: number
          airtime_lotto_balance?: number
          branch_net_sales?: number
          branch_total_invoices_capital?: number
          branch_total_invoices_vat?: number
          branch_total_payouts?: number
          branch_total_receipts?: number
          created_at?: string
          entered_by?: string
          explanation_invoices?: string
          explanation_net_sales?: string
          explanation_payouts?: string
          explanation_receipts?: string
          explanation_vat?: string
          id?: string
          month: string
          notes?: string
          sales_c_store?: number
          sales_fuel?: number
          sales_gas?: number
          sales_oil?: number
          sales_wsl_dsl?: number
          updated_at?: string
          vat_tax_amount?: number
        }
        Update: {
          adj_c_store?: number
          adj_fuel?: number
          adj_gas?: number
          adj_oil?: number
          adj_vat?: number
          adj_wsl_dsl?: number
          airtime_bld_balance?: number
          airtime_easypay_balance?: number
          airtime_lotto_balance?: number
          branch_net_sales?: number
          branch_total_invoices_capital?: number
          branch_total_invoices_vat?: number
          branch_total_payouts?: number
          branch_total_receipts?: number
          created_at?: string
          entered_by?: string
          explanation_invoices?: string
          explanation_net_sales?: string
          explanation_payouts?: string
          explanation_receipts?: string
          explanation_vat?: string
          id?: string
          month?: string
          notes?: string
          sales_c_store?: number
          sales_fuel?: number
          sales_gas?: number
          sales_oil?: number
          sales_wsl_dsl?: number
          updated_at?: string
          vat_tax_amount?: number
        }
        Relationships: []
      }
      other_adj_bank_clearances: {
        Row: {
          adjustment_id: string
          amount: number
          bank_line_id: string
          cashup_date: string
          created_at: string
          id: string
          month: string
        }
        Insert: {
          adjustment_id: string
          amount?: number
          bank_line_id: string
          cashup_date: string
          created_at?: string
          id?: string
          month: string
        }
        Update: {
          adjustment_id?: string
          amount?: number
          bank_line_id?: string
          cashup_date?: string
          created_at?: string
          id?: string
          month?: string
        }
        Relationships: []
      }
      other_adjustment_categories: {
        Row: {
          adjustment_id: string
          cashup_date: string
          category: string
          created_at: string
          id: string
          month: string
        }
        Insert: {
          adjustment_id: string
          cashup_date: string
          category?: string
          created_at?: string
          id?: string
          month: string
        }
        Update: {
          adjustment_id?: string
          cashup_date?: string
          category?: string
          created_at?: string
          id?: string
          month?: string
        }
        Relationships: []
      }
      pump_variance_revisions: {
        Row: {
          created_at: string
          date: string
          explanation: string
          id: string
          month: string
          pump_no: string
          revised_calc_volume: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          explanation?: string
          id?: string
          month: string
          pump_no: string
          revised_calc_volume?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          explanation?: string
          id?: string
          month?: string
          pump_no?: string
          revised_calc_volume?: number
          updated_at?: string
        }
        Relationships: []
      }
      recon_adjustment_audit: {
        Row: {
          changed_by: string
          created_at: string
          field: string
          id: string
          month: string
          new_amount: number
          old_amount: number | null
          reason: string
          recon_type: string
          target_name: string
          week_index: number | null
        }
        Insert: {
          changed_by?: string
          created_at?: string
          field: string
          id?: string
          month: string
          new_amount: number
          old_amount?: number | null
          reason?: string
          recon_type: string
          target_name: string
          week_index?: number | null
        }
        Update: {
          changed_by?: string
          created_at?: string
          field?: string
          id?: string
          month?: string
          new_amount?: number
          old_amount?: number | null
          reason?: string
          recon_type?: string
          target_name?: string
          week_index?: number | null
        }
        Relationships: []
      }
      recon_adjustments: {
        Row: {
          amount: number
          created_at: string
          field: string
          id: string
          month: string
          recon_type: string
          target_name: string
          updated_at: string
          week_index: number | null
        }
        Insert: {
          amount?: number
          created_at?: string
          field: string
          id?: string
          month: string
          recon_type: string
          target_name: string
          updated_at?: string
          week_index?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          field?: string
          id?: string
          month?: string
          recon_type?: string
          target_name?: string
          updated_at?: string
          week_index?: number | null
        }
        Relationships: []
      }
      speedpoint_diff_clearances: {
        Row: {
          amount: number
          created_at: string
          date_1: string
          date_2: string
          group_id: string | null
          id: string
          month: string
          terminal: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date_1: string
          date_2: string
          group_id?: string | null
          id?: string
          month: string
          terminal: string
        }
        Update: {
          amount?: number
          created_at?: string
          date_1?: string
          date_2?: string
          group_id?: string | null
          id?: string
          month?: string
          terminal?: string
        }
        Relationships: []
      }
      speedpoint_manual_matches: {
        Row: {
          bank_amount: number
          bank_batch: string
          bank_date: string
          bank_description: string
          bank_line_id: string | null
          bank_line_idx: number
          bank_terminal: string
          cashup_date: string
          created_at: string
          id: string
          month: string
          terminal: string
        }
        Insert: {
          bank_amount?: number
          bank_batch?: string
          bank_date?: string
          bank_description?: string
          bank_line_id?: string | null
          bank_line_idx: number
          bank_terminal?: string
          cashup_date: string
          created_at?: string
          id?: string
          month: string
          terminal: string
        }
        Update: {
          bank_amount?: number
          bank_batch?: string
          bank_date?: string
          bank_description?: string
          bank_line_id?: string | null
          bank_line_idx?: number
          bank_terminal?: string
          cashup_date?: string
          created_at?: string
          id?: string
          month?: string
          terminal?: string
        }
        Relationships: []
      }
      speedpoint_unmatched_auto: {
        Row: {
          bank_line_id: string
          batch: string
          created_at: string
          id: string
          month: string
          terminal: string
        }
        Insert: {
          bank_line_id: string
          batch: string
          created_at?: string
          id?: string
          month: string
          terminal: string
        }
        Update: {
          bank_line_id?: string
          batch?: string
          created_at?: string
          id?: string
          month?: string
          terminal?: string
        }
        Relationships: []
      }
    }
    Views: {
      bp_invoices_monthly_summary: {
        Row: {
          invoice_count: number | null
          invoice_type: string | null
          month: string | null
          total_amount: number | null
          total_capital: number | null
          total_vat: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
