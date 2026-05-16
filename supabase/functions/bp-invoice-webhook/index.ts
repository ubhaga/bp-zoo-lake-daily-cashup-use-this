import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BodySchema = z.object({
  invoice_number: z.string().trim().max(255).optional().nullable(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invoice_date must be YYYY-MM-DD'),
  invoice_type: z.string().trim().min(1).max(100),
  amount_capital: z.number().or(z.string().transform((v) => Number(v))).default(0),
  amount_vat: z.number().or(z.string().transform((v) => Number(v))).default(0),
  description: z.string().max(5000).optional().nullable(),
  month: z.string().trim().max(20).optional().nullable(),
  source_email: z.string().trim().max(500).optional().nullable(),
  pdf_filename: z.string().trim().max(500).optional().nullable(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const json = await req.json().catch(() => null);
    if (!json) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ success: false, error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const d = parsed.data;
    const { data, error } = await supabase
      .from('bp_invoices')
      .insert({
        supplier: 'BP',
        invoice_number: d.invoice_number ?? null,
        invoice_date: d.invoice_date,
        invoice_type: d.invoice_type,
        amount_capital: d.amount_capital ?? 0,
        amount_vat: d.amount_vat ?? 0,
        amount_total: (Number(d.amount_capital) || 0) + (Number(d.amount_vat) || 0),
        description: d.description ?? null,
        month: d.month ?? null,
        source_email: d.source_email ?? null,
        pdf_filename: d.pdf_filename ?? null,
        classified_by: 'webhook',
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, invoice: data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
