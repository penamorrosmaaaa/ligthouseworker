import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

// ✅ Supabase setup (values embedded directly)
const supabase = createClient(
  'https://amvikoumsiymrvgxlsog.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtdmlrb3Vtc2l5bXJ2Z3hsc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MDE4NDYsImV4cCI6MjA2NTE3Nzg0Nn0.GsFEqjceDI36JOsHFr9-nQOSdQ-rlvM1VhoTC6DvLdE'
);

async function runLighthouseForPendingUrls() {
  const { data: queue, error } = await supabase
    .from('lighthouse_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('status', 'pending')
    .order('id', { ascending: true })
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

      await supabase.from('lighthouse_results').insert([
        {
          url,
          performance: result.lhr.categories.performance.score * 100,
          lcp: result.lhr.audits['largest-contentful-paint']?.numericValue || null,
          fcp: result.lhr.audits['first-contentful-paint']?.numericValue || null,
          cls: result.lhr.audits['cumulative-layout-shift']?.numericValue || null,
          tbt: result.lhr.audits['total-blocking-time']?.numericValue || null,
          si: result.lhr.audits['speed-index']?.numericValue || null,
          json: result.lhr,
          created_at: new Date().toISOString()
        }
      ]);

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

async function loop() {
  await runLighthouseForPendingUrls();
  setTimeout(loop, 10000); // Retry every 10 seconds
}

loop();
