import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function runLighthouseForPendingUrls() {
  // Toma y bloquea una URL en el mismo paso
  const { data: queue, error } = await supabase
    .from('lighthouse_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('status', 'pending')
    .order('id', { ascending: true })  // ✅ requerido por Supabase para usar limit
    .select()
    .limit(1);

  if (error) {
    console.error('❌ Error fetching queue:', error.message);
    return;
  }

  if (!queue || queue.length === 0) {
    console.log('⏳ No pending URLs to process.');
    return;
  }

  for (const item of queue) {
    const url = item.url;
    const id = item.id;

    console.log(`⏳ Starting Lighthouse test for: ${url}`);

    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox']
      });

      const port = new URL(browser.wsEndpoint()).port;

      const result = await lighthouse(url, {
        port,
        output: 'json',
        logLevel: 'info'
      });

      await browser.close();

      // Inserta los resultados
      await supabase.from('lighthouse_results').insert([
        {
          url,
          performance: result.lhr.categories.performance.score * 100,
          lcp: result.lhr.audits['largest-contentful-paint']?.numericValue || null,
          fcp: result.lhr.audits['first-contentful-paint']?.numericValue || null,
          cls: result.lhr.audits['cumulative-layout-shift']?.numericValue || null,
          tbt: result.lhr.audits['total-blocking-time']?.numericValue || null,
          json: result.lhr,  // o result.report si prefieres string
          created_at: new Date().toISOString()
        }
      ]);

      // Marca como terminado
      await supabase
        .from('lighthouse_queue')
        .update({ status: 'done', finished_at: new Date().toISOString() })
        .eq('id', id);

      console.log(`✅ Done: ${url}`);
    } catch (err) {
      console.error(`❌ Failed: ${url}`, err.message);

      await supabase
        .from('lighthouse_queue')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
}

// Ejecuta cada 10 segundos
async function loop() {
  await runLighthouseForPendingUrls();
  setTimeout(loop, 10000); // espera 10s después de terminar
}

loop(); // inicia

