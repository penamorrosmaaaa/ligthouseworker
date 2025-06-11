import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

// ✅ Supabase client
const supabase = createClient(
  'https://amvikoumsiymrvgxlsog.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtdmlrb3Vtc2l5bXJ2Z3hsc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MDE4NDYsImV4cCI6MjA2NTE3Nzg0Nn0.GsFEqjceDI36JOsHFr9-nQOSdQ-rlvM1VhoTC6DvLdE'
);

// ✅ Extraer métricas web-vitals usando puppeteer
async function extractVitalsFromPage(url) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  console.log(`🌐 Visiting: ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  await page.addScriptTag({
    url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js',
  });

  const vitals = await page.evaluate(() => {
    return new Promise((resolve) => {
      const results = {};
      let count = 0;

      const done = () => {
        if (++count >= 3) resolve(results);
      };

      webVitals.getLCP((metric) => {
        results.lcp = metric.value;
        done();
      });

      webVitals.getCLS((metric) => {
        results.cls = metric.value;
        done();
      });

      webVitals.getINP((metric) => {
        results.inp = metric.value;
        done();
      });
    });
  });

  await browser.close();
  return vitals;
}

// ✅ Procesar la cola de métricas
async function runWebVitalsQueue() {
  const { data: queue, error } = await supabase
    .from('web_vitals_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .select()
    .limit(1);

  if (error) {
    console.error('❌ Error reading queue:', error.message);
    return;
  }

  if (!queue || queue.length === 0) {
    console.log('⏳ No pending URLs.');
    return;
  }

  for (const item of queue) {
    const { url, id } = item;

    try {
      console.log(`🚀 Processing: ${url}`);
      const vitals = await extractVitalsFromPage(url);

      console.log(`📊 Extracted for ${url} → LCP: ${vitals.lcp} | CLS: ${vitals.cls} | INP: ${vitals.inp}`);

      await supabase.from('web_vitals_results').insert([{
        url,
        lcp: vitals.lcp,
        cls: vitals.cls,
        inp: vitals.inp,
        created_at: new Date().toISOString()
      }]);

      await supabase
        .from('web_vitals_queue')
        .update({ status: 'done', finished_at: new Date().toISOString() })
        .eq('id', id);

      console.log(`✅ Saved metrics for ${url}`);
    } catch (err) {
      console.error(`❌ Failed for ${url}: ${err.message}`);

      await supabase
        .from('web_vitals_queue')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
}

// ✅ Bucle cada 10 segundos
async function loop() {
  await runWebVitalsQueue();
  setTimeout(loop, 10000);
}

loop();
