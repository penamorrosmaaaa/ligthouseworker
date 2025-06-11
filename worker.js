// webVitalsRunner.js
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://amvikoumsiymrvgxlsog.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtdmlrb3Vtc2l5bXJ2Z3hsc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MDE4NDYsImV4cCI6MjA2NTE3Nzg0Nn0.GsFEqjceDI36JOsHFr9-nQOSdQ-rlvM1VhoTC6DvLdE'
);

async function extractVitalsFromPage(url) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  await page.addScriptTag({
    url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js',
  });

  const vitals = await page.evaluate(() => {
    return new Promise((resolve) => {
      const results = {};
      let count = 0;

      const checkDone = () => {
        if (++count >= 3) resolve(results); // Wait for 3 metrics
      };

      webVitals.getLCP((metric) => {
        results.lcp = metric.value;
        checkDone();
      });

      webVitals.getCLS((metric) => {
        results.cls = metric.value;
        checkDone();
      });

      webVitals.getINP((metric) => {
        results.inp = metric.value;
        checkDone();
      });
    });
  });

  await browser.close();
  return vitals;
}

async function runWebVitalsQueue() {
  const { data: queue, error } = await supabase
    .from('lighthouse_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .select()
    .limit(1);

  if (error || !queue || queue.length === 0) {
    console.log('⏳ No pending URLs.');
    return;
  }

  for (const item of queue) {
    const { url, id } = item;

    try {
      console.log(`🚀 Processing: ${url}`);
      const vitals = await extractVitalsFromPage(url);

      await supabase.from('web_vitals').insert([{
        url,
        lcp: vitals.lcp,
        cls: vitals.cls,
        inp: vitals.inp,
        created_at: new Date().toISOString(),
      }]);

      await supabase
        .from('lighthouse_queue')
        .update({ status: 'done', finished_at: new Date().toISOString() })
        .eq('id', id);

      console.log(`✅ Metrics saved for ${url}`);
    } catch (err) {
      console.error(`❌ Error for ${url}:`, err.message);
      await supabase
        .from('lighthouse_queue')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
}

async function loop() {
  await runWebVitalsQueue();
  setTimeout(loop, 10000); // every 10s
}

loop();
