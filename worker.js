import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://amvikoumsiymrvgxlsog.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtdmlrb3Vtc2l5bXJ2Z3hsc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MDE4NDYsImV4cCI6MjA2NTE3Nzg0Nn0.GsFEqjceDI36JOsHFr9-nQOSdQ-rlvM1VhoTC6DvLdE'
);

async function extractWebVitals(url) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  await page.addScriptTag({ url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js' });

  const vitals = await page.evaluate(() => {
    return new Promise((resolve) => {
      const results = {};
      let collected = 0;

      const done = () => {
        collected++;
        if (collected >= 3) resolve(results);
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

async function runQueue() {
  const { data: queue, error } = await supabase
    .from('web_vitals_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .select()
    .limit(1);

  if (error) {
    console.error('❌ Supabase queue fetch error:', error.message);
    return;
  }

  if (!queue || queue.length === 0) {
    console.log('⏳ No pending URLs in queue.');
    return;
  }

  for (const item of queue) {
    const { id, url } = item;
    console.log(`📡 Processing: ${url}`);

    try {
      const vitals = await extractWebVitals(url);

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

      console.log(`✅ Metrics saved for ${url}`);
    } catch (err) {
      console.error(`❌ Error processing ${url}:`, err.message);
      await supabase
        .from('web_vitals_queue')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
}

async function loop() {
  await runQueue();
  setTimeout(loop, 10000); // cada 10s
}

loop();
