import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { procedure_id, language, concern } = await req.json()

    if (!procedure_id) {
      return new Response(JSON.stringify({ error: 'procedure_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const lang = language || 'en'
    const patientConcern = concern || 'cost'

    // Check cache first
    const { data: cached } = await supabaseAdmin
      .from('ai_explanations_cache')
      .select('explanation')
      .eq('procedure_id', procedure_id)
      .eq('language', lang)
      .eq('concern', patientConcern)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (cached) {
      await supabaseAdmin.rpc('increment_cache_usage', {
        p_procedure_id: procedure_id,
        p_language: lang,
        p_concern: patientConcern,
      })
      return new Response(JSON.stringify({ explanation: cached.explanation, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get procedure info from catalog
    const { data: proc } = await supabaseAdmin
      .from('procedures_catalog')
      .select('*')
      .eq('id', procedure_id)
      .single()

    const procName = proc ? (lang === 'es' ? proc.name_es : proc.name_en) : procedure_id
    const procDesc = proc ? (lang === 'es' ? proc.description_es : proc.description_en) : ''
    const procPrice = proc ? proc.base_price : 0

    const systemPrompt = `You are an expert dental patient educator. Your job is to explain dental procedures in a way that builds trust and motivates treatment acceptance.

RULES:
- Reading level: 8th grade maximum
- Tone: Empathetic, reassuring, never scary
- Focus on "what this means for YOU and your health"
- Length: 120-150 words maximum
- Structure: what the problem is (1 sentence), what the procedure does (2-3 sentences), what happens if you wait (specific timeframes and costs), reassuring closing (1 sentence)
- Never use medical jargon without immediate explanation
- No fear-mongering or guilt
${lang === 'es' ? '- Respond in Spanish (Mexican conventions)' : '- Respond in English'}`

    const userPrompt = `Explain this dental procedure to a patient:
PROCEDURE: ${procName}
DESCRIPTION: ${procDesc}
COST: $${procPrice}
PATIENT CONCERN: ${patientConcern}

Write a compelling explanation that helps them understand WHY they need this NOW.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const explanation = data.content[0].text

    // Cache the result
    await supabaseAdmin.from('ai_explanations_cache').upsert(
      {
        procedure_id,
        language: lang,
        concern: patientConcern,
        explanation,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'procedure_id,language,concern' }
    )

    return new Response(JSON.stringify({ explanation, cached: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ explanation: null, error: (err as Error).message }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
